/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Связь «я ↔ один участник» (specs/004-group-calls R1): своя WebRTC-сессия, туннель, звук и индикатор речи.
// Автомат вызова (state.ts) у каждой связи свой; треки микрофона, камеры и демки общие — их держит контроллер.

import { PluginNative } from "@utils/types";

import { Caps, CodecChoice } from "./codecs";
import { LevelMeter } from "./levelMeter";
import { playStream } from "./media";
import type { TunnelPrepared } from "./native";
import { OutSignal, Session, TrackKind } from "./session";
import type { SignalMsg } from "./signaling";
import { CallState, isPolite, Peer } from "./state";
import { CallStats } from "./stats";
import { StreamQuality } from "./streamQuality";

const Native = VencordNative.pluginHelpers.P2PCall as PluginNative<typeof import("./native")>;

/** Туннель связи: своя сторона (info) и что прислал собеседник в `tun` */
export interface CallTunnel {
    callId: string;
    info: TunnelPrepared | null;
    sent: boolean;
    peer: { addr: string | null; token: string; upnp: string; upnpCode: number | null; } | null;
    linked: boolean;
}

/** Подсказка к «P2P-звонок не удался»: туннель упирается в UPnP на роутере той стороны, где он выключен */
export function tunnelHint(t: Pick<CallTunnel, "info" | "peer"> | null): string | null {
    if (!t) return null;
    const side = (upnp: string) => upnp === "error" ? "роутер отказал в пробросе порта" : "UPnP на роутере не отвечает";
    const own = t.info && t.info.upnp !== "ok" ? `у тебя ${side(t.info.upnp)}` : null;
    const peer = t.peer && t.peer.upnp !== "ok" ? `у собеседника ${side(t.peer.upnp)}` : null;
    if (!own && !peer) return null;
    return `Порт для прямого соединения не открылся: ${[own, peer].filter(Boolean).join(", ")}`;
}

export interface LinkTracks { mic: MediaStream | null; cam: MediaStream | null; screen: MediaStream | null; quality: StreamQuality; receivers: number; }

export interface LinkHost {
    selfId: string;
    send(link: PeerLink, body: Omit<SignalMsg, "msgId" | "callId" | "from" | "ts">): void;
    ownCaps: Promise<Caps>;
    codec(): CodecChoice;
    outputDevice(): string;
    deafened(): boolean;
    audioCtx(): AudioContext;
    iceState(link: PeerLink, st: RTCIceConnectionState): void;
    changed(): void;
}

/** Кандидаты ICE копятся столько и уходят одним сообщением: по сообщению на кандидат ретрансляторы банят за спам */
export const ICE_BATCH_MS = 150;

export class PeerLink {
    state: CallState = { phase: "idle" };
    timers: ReturnType<typeof setTimeout>[] = [];
    /** Входящий во время звонка — окно с «Добавить сюда» */
    invite = false;
    /** Связь внутри группы без окна (R5) */
    auto = false;
    /** Исходящее приглашение в идущий звонок */
    inviteOut = false;
    /** Что умеет версия собеседника — из его ring/accept */
    caps: string[] = [];
    /** Устройство собеседника, чьим ключом пары открыты его сообщения */
    deviceId: string | null = null;
    /** Дополнительные поля в ring и accept этой связи (группа, ключи) */
    ringExtra: Partial<SignalMsg> = {};
    acceptExtra: Partial<SignalMsg> = {};
    /** Группа и ключи из входящего ring или ответного accept — применяются, когда связь поднялась */
    joinGroup: SignalMsg["group"] | null = null;
    joinKeys: SignalMsg["keys"] = [];
    readonly createdAt = Date.now();
    lastRingAt = 0;

    session: Session | null = null;
    remote: Partial<Record<TrackKind, MediaStream>> = {};
    speaking = false;
    /** Микрофон и звук собеседника по его сообщению audio */
    remoteAudio = { mic: true, deaf: false };
    stats: CallStats | null = null;
    tun: CallTunnel | null = null;
    lastTun: CallTunnel | null = null;
    private pendingSignals: OutSignal[] = [];
    private iceRestarted = false;
    private audio: HTMLAudioElement | null = null;
    private meter: LevelMeter | null = null;
    private statsTimer: ReturnType<typeof setInterval> | undefined;
    private closed = false;

    constructor(readonly linkId: string, readonly peer: Peer, private host: LinkHost) { }

    get userId() { return this.peer.peerId; }
    get groupCapable() { return this.caps.includes("group"); }

    /** tracks — функция: камеру и демку читаем после микрофона, их могли выключить, пока он ставился */
    start(tracks: () => LinkTracks) {
        if (this.session || this.closed) return;
        this.iceRestarted = false;
        const session = new Session(isPolite(this.host.selfId, this.userId), {
            signal: m => m.type === "ice" ? this.sendIce(m.candidate) : this.host.send(this, { type: m.type, sdp: m.sdp }),
            remoteMedia: (kind, stream) => this.onRemote(kind, stream),
            iceState: st => this.onIce(st),
        }, { ownCaps: this.host.ownCaps, codec: () => this.host.codec() });
        this.session = session;
        this.sendTun();
        this.linkTunnel();
        return (async () => {
            // микрофон в первом offer — без второго раунда переговоров
            const { mic } = tracks();
            if (mic) await session.setTrack("mic", mic);
            if (this.session !== session) return;
            const t = tracks();
            if (t.cam) await session.setTrack("cam", t.cam);
            if (t.screen) {
                await session.setScreenQuality(t.quality, t.receivers);
                await session.setTrack("screen", t.screen);
            }
            if (this.session !== session) return;
            for (const s of this.pendingSignals.splice(0)) session.handle(s).catch(e => console.error("[P2PCall] signal", e));
            this.statsTimer = setInterval(async () => {
                if (this.session !== session) return;
                this.stats = await session.stats();
                this.host.changed();
            }, 1000);
        })();
    }

    handleSignal(s: OutSignal) {
        if (this.session) this.session.handle(s).catch(e => console.error("[P2PCall] signal", e));
        else this.pendingSignals.push(s);
    }

    private iceOut: (RTCIceCandidateInit | null)[] = [];
    private iceTimer: ReturnType<typeof setTimeout> | undefined;

    /** Старой версии — по одному, как раньше; новой — пачкой (caps `icebatch`) */
    private sendIce(candidate: RTCIceCandidateInit | null) {
        if (!this.caps.includes("icebatch")) { this.host.send(this, { type: "ice", candidate }); return; }
        this.iceOut.push(candidate);
        // конец кандидатов — сразу: дальше ждать нечего
        if (candidate === null) this.flushIce();
        else this.iceTimer ??= setTimeout(() => this.flushIce(), ICE_BATCH_MS);
    }

    private flushIce() {
        clearTimeout(this.iceTimer);
        this.iceTimer = undefined;
        if (!this.iceOut.length || this.closed) { this.iceOut = []; return; }
        this.host.send(this, { type: "ice", cands: this.iceOut });
        this.iceOut = [];
    }

    setDeafened(d: boolean) {
        if (this.audio) this.audio.muted = d;
    }

    setOutput(deviceId: string) {
        (this.audio as any)?.setSinkId?.(deviceId || "default").catch(() => { });
    }

    /** Туннель готовится, пока идёт вызов; ошибки только в лог — без туннеля связь ведёт себя как раньше */
    prepareTunnel() {
        if (this.tun || this.closed) return;
        const t: CallTunnel = { callId: this.linkId, info: null, sent: false, peer: null, linked: false };
        this.tun = t;
        Native.tunnelPrepare(this.linkId).then(info => {
            if (this.tun !== t) return;
            t.info = info;
            console.info("[P2PCall] tunnel", JSON.stringify(info ? { link: this.linkId, addr: info.addr, upnp: info.upnp, upnpCode: info.upnpCode, lanIp: info.lanIp, proxyPort: info.proxyPort } : { link: this.linkId, failed: true }));
            this.sendTun();
            this.linkTunnel();
        }, e => console.warn("[P2PCall] tunnel", e));
    }

    onTun(m: SignalMsg) {
        const t = this.tun;
        if (!t || typeof m.token !== "string") return;
        t.peer = { addr: typeof m.addr === "string" ? m.addr : null, token: m.token, upnp: typeof m.upnp === "string" ? m.upnp : "error", upnpCode: typeof m.upnpCode === "number" ? m.upnpCode : null };
        console.info("[P2PCall] tunnel peer", JSON.stringify({ link: this.linkId, addr: t.peer.addr, upnp: t.peer.upnp, upnpCode: t.peer.upnpCode }));
        this.linkTunnel();
    }

    /** Свой адрес — собеседнику, как только есть и туннель, и сессия */
    private sendTun() {
        const t = this.tun;
        if (!t?.info || t.sent || !this.session) return;
        t.sent = true;
        this.host.send(this, { type: "tun", addr: t.info.addr, token: t.info.token, upnp: t.info.upnp, upnpCode: t.info.upnpCode });
    }

    /**
     * Кандидат туннеля — только когда собеседник тоже с туннелем (старой версии он не нужен) и адреса есть
     * у обоих: иначе одна сторона слала бы в туннель, который у другой не принимает пакеты.
     */
    private linkTunnel() {
        const t = this.tun;
        if (!t?.info?.addr || !t.peer?.addr || !this.session || t.linked) return;
        t.linked = true;
        Native.tunnelSetPeer(t.callId, { addr: t.peer.addr, token: t.peer.token }).catch(e => console.warn("[P2PCall] tunnel", e));
        this.session.addTunnelCandidate(t.info.lanIp, t.info.proxyPort);
    }

    closeTunnel() {
        const t = this.tun;
        if (!t) return;
        this.tun = null;
        this.lastTun = t;
        // итог туннеля в лог до закрытия — у несостоявшейся связи другого следа не будет
        const { state } = this;
        Native.tunnelStatus(t.callId).then(st => console.info("[P2PCall] tunnel end", JSON.stringify({
            link: this.linkId, end: state.phase === "ended" ? state.reason : state.phase, own: t.info?.upnp ?? null, peer: t.peer?.upnp ?? null, linked: t.linked, status: st,
        })), () => { });
        Native.tunnelClose(t.callId).catch(() => { });
    }

    stopSession() {
        clearInterval(this.statsTimer);
        this.session?.close();
        this.session = null;
        this.pendingSignals = [];
        this.audio?.pause();
        this.audio = null;
        this.meter?.stop();
        this.meter = null;
        this.remote = {};
        this.speaking = false;
        this.stats = null;
    }

    close() {
        this.closed = true;
        clearTimeout(this.iceTimer);
        this.iceOut = [];
        this.timers.forEach(clearTimeout);
        this.timers = [];
        this.stopSession();
        this.closeTunnel();
    }

    private onRemote(kind: TrackKind, stream: MediaStream | null) {
        // remoteMedia может прийти дважды для одного потока (ontrack и метки kinds) — второй раз ничего не делаем
        if (kind === "mic" && stream !== this.meter?.stream) {
            this.audio?.pause();
            this.audio = stream ? playStream(stream, this.host.outputDevice()) : null;
            if (this.audio) this.audio.muted = this.host.deafened();
            this.meter?.stop();
            this.meter = stream
                ? new LevelMeter(this.host.audioCtx(), stream, s => { this.speaking = s; this.host.changed(); }, () => true)
                : null;
            if (!stream) this.speaking = false;
        }
        const remote = { ...this.remote };
        if (stream) remote[kind] = stream; else delete remote[kind];
        this.remote = remote;
        this.host.changed();
    }

    private onIce(st: RTCIceConnectionState) {
        if (st === "disconnected" && !this.iceRestarted) { this.iceRestarted = true; this.session?.restartIce(); }
        this.host.iceState(this, st);
    }
}
