/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

import { CodecChoice, probeCaps } from "./codecs";
import { newCallId, pairHint } from "./crypto";
import { compactStats } from "./diagLog";
import { LevelMeter } from "./levelMeter";
import { INITIAL_AUDIO, LocalAudio, toggleDeafenState, toggleMicState } from "./localAudio";
import { getCamera, getMic, getScreen, playStream } from "./media";
import type { TunnelPrepared } from "./native";
import { startRingtone, stopRingtone } from "./ringtone";
import { OutSignal, Session, TrackKind } from "./session";
import { relayList, savedQuality, saveQuality, settings } from "./settings";
import { PeerCtx, Signaling,SignalMsg } from "./signaling";
import { CallEvent, CallState, Effect, isMissedCall, isPolite, Peer, reduce } from "./state";
import { CallStats } from "./stats";
import { needsRecapture, StreamQuality, trackConstraints } from "./streamQuality";

const Native = VencordNative.pluginHelpers.P2PCall as PluginNative<typeof import("./native")>;

export interface View {
    call: CallState;
    relaysUp: number;
    remote: Partial<Record<TrackKind, MediaStream>>;
    local: { mic: boolean; cam: MediaStream | null; screen: MediaStream | null; };
    deafened: boolean;
    speaking: { self: boolean; peer: boolean; };
    stats: CallStats | null;
    screenQuality: StreamQuality;
}

interface Hooks {
    offerFallback(channelId: string, hint: string | null): void;
    warn(text: string): void;
    inVoiceChannel(): boolean;
    dmPeers(): PeerCtx[];
    onIncoming(): void;
    info(text: string): void;
}

const ENDED_SHOW_MS = 3000;

/** Что реально выдал захват: разрешение и FPS по настройкам трека — сравнить с выбранным качеством */
function captureInfo(stream: MediaStream | null) {
    const s = stream?.getVideoTracks()[0]?.getSettings();
    return s ? `${s.width}x${s.height}@${Math.round(s.frameRate ?? 0)} ${s.displaySurface ?? "legacy"}` : null;
}
/** Туннель звонка: своя сторона (info) и что прислал собеседник в `tun` */
interface CallTunnel {
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

const NO_LOCAL: View["local"] = { mic: true, cam: null, screen: null };
const NOT_SPEAKING: View["speaking"] = { self: false, peer: false };

export class CallController {
    private v: View = { call: { phase: "idle" }, relaysUp: 0, remote: {}, local: NO_LOCAL, deafened: false, speaking: NOT_SPEAKING, stats: null, screenQuality: savedQuality() };
    private listeners = new Set<() => void>();
    private sig: Signaling | null = null;
    private session: Session | null = null;
    private peer: Peer | null = null;
    private timers: ReturnType<typeof setTimeout>[] = [];
    private resetTimer: ReturnType<typeof setTimeout> | undefined;
    private resetFor: CallState | null = null;
    private statsTimer: ReturnType<typeof setInterval> | undefined;
    private audio: HTMLAudioElement | null = null;
    private mic: MediaStream | null = null;
    private pendingSignals: OutSignal[] = [];
    private iceRestarted = false;
    private camBusy = false;
    private ownCaps = probeCaps().then(c => { console.info("[P2PCall] codecs", JSON.stringify(c)); return c; });
    private screenSource: string | null = null;
    private capturedQuality: StreamQuality | null = null;
    private qualityQueue: Promise<void> = Promise.resolve();
    private diagTimer: ReturnType<typeof setInterval> | undefined;
    private audioState: LocalAudio = INITIAL_AUDIO;
    private audioCtx: AudioContext | null = null;
    private selfMeter: LevelMeter | null = null;
    private peerMeter: LevelMeter | null = null;
    private hints = new Map<string, PeerCtx>();
    private tun: CallTunnel | null = null;
    /** Туннель только что закрытого звонка — для подсказки в offer-fallback, который идёт после leave-room */
    private lastTun: CallTunnel | null = null;

    constructor(private selfId: string, private hooks: Hooks) { }

    get view() { return this.v; }

    subscribe(fn: () => void) {
        this.listeners.add(fn);
        return () => { this.listeners.delete(fn); };
    }

    private set(patch: Partial<View>) {
        this.v = { ...this.v, ...patch };
        this.listeners.forEach(f => f());
    }

    start() {
        this.sig = new Signaling({
            selfId: this.selfId,
            relays: relayList(),
            ws: url => new WebSocket(url) as any,
            resolvePair: h => this.resolvePair(h),
            onMessage: (m, ctx) => this.onSignal(m, ctx),
            onStatus: n => this.set({ relaysUp: n }),
        });
        this.sig.start();
    }

    stop() {
        if (this.v.call.phase !== "idle" && this.v.call.phase !== "ended") this.dispatch({ type: "hangup" });
        clearTimeout(this.resetTimer);
        this.run({ kind: "clear-timers" });
        this.closeTunnel();
        this.sig?.stop();
        this.sig = null;
    }

    private resolvePair(hint: string): PeerCtx | null {
        let ctx = this.hints.get(hint);
        if (!ctx) {
            this.hints.clear();
            for (const p of this.hooks.dmPeers()) this.hints.set(pairHint(p.channelId), p);
            ctx = this.hints.get(hint);
        }
        return ctx ?? null;
    }

    dial(channelId: string, peerId: string, video: boolean) {
        if (this.hooks.inVoiceChannel()) this.hooks.warn("Ты сейчас в голосовом канале Discord — он продолжит работать параллельно");
        this.dispatch({ type: "dial", callId: newCallId(), channelId, peerId, video });
    }
    accept(video = false) {
        if (this.hooks.inVoiceChannel()) this.hooks.warn("Идут два звонка: P2P и Discord");
        this.dispatch({ type: "accept", video });
    }

    decline() { this.dispatch({ type: "decline" }); }
    hangup() { this.dispatch({ type: "hangup" }); }

    toggleMic() {
        this.audioState = toggleMicState(this.audioState);
        this.applyAudio();
    }

    toggleDeafen() {
        this.audioState = toggleDeafenState(this.audioState);
        this.applyAudio();
    }

    private applyAudio() {
        const { mic, deafened } = this.audioState;
        this.mic?.getAudioTracks().forEach(t => { t.enabled = mic; });
        if (this.audio) this.audio.muted = deafened;
        this.set({ local: { ...this.v.local, mic }, deafened });
    }

    async toggleCam() {
        const { session } = this;
        // повторный клик, пока камера включается, не должен захватить вторую
        if (!session || this.camBusy) return;
        this.camBusy = true;
        try {
            if (this.v.local.cam) {
                await session.setTrack("cam", null);
                this.set({ local: { ...this.v.local, cam: null } });
                return;
            }
            const cam = await getCamera(settings.store.cameraDevice);
            if (this.session !== session) { cam.getTracks().forEach(t => t.stop()); return; }
            await session.setTrack("cam", cam);
            this.set({ local: { ...this.v.local, cam } });
        } catch (e) {
            this.hooks.warn("Камера недоступна: " + (e as Error).message);
        } finally {
            this.camBusy = false;
        }
    }

    async startScreen(sourceId: string, q: StreamQuality) {
        const { session } = this;
        if (!session) return;
        saveQuality(q);
        this.set({ screenQuality: q });
        try {
            const screen = await getScreen(sourceId, q);
            if (this.session !== session) { screen.getTracks().forEach(t => t.stop()); return; }
            screen.getVideoTracks()[0].onended = () => { this.stopScreen(); };
            this.screenSource = sourceId;
            this.capturedQuality = q;
            await session.setScreenQuality(q);
            await session.setTrack("screen", screen);
            this.set({ local: { ...this.v.local, screen } });
        } catch (e) {
            this.hooks.warn("Не удалось захватить экран: " + (e as Error).message);
        }
    }

    async stopScreen() {
        if (!this.session || !this.v.local.screen) return;
        await this.session.setTrack("screen", null);
        this.screenSource = null;
        this.capturedQuality = null;
        this.set({ local: { ...this.v.local, screen: null } });
    }

    /** Смена качества на ходу. Строго по очереди — иначе параллельные перезахваты теряют треки */
    setScreenQuality(q: StreamQuality): Promise<void> {
        const run = this.qualityQueue.then(() => this.applyScreenQuality(q));
        this.qualityQueue = run.catch(() => { });
        return run;
    }

    /** Понижение — applyConstraints; повышение (или отказ applyConstraints) — новый захват того же источника */
    private async applyScreenQuality(q: StreamQuality) {
        const { session } = this;
        const stream = this.v.local.screen;
        if (!session || !stream || !this.capturedQuality) {
            saveQuality(q);
            this.set({ screenQuality: q });
            return;
        }
        let ok = false;
        if (!needsRecapture(this.capturedQuality, q)) {
            try {
                await stream.getVideoTracks()[0]?.applyConstraints(trackConstraints(q));
                ok = true;
            } catch { }
        }
        if (!ok && this.screenSource) {
            try {
                const fresh = await getScreen(this.screenSource, q);
                if (this.session !== session) { fresh.getTracks().forEach(t => t.stop()); return; }
                const t = fresh.getVideoTracks()[0];
                t.onended = () => { this.stopScreen(); };
                await session.replaceScreenTrack(t);
                this.capturedQuality = q;
                ok = true;
            } catch { }
        }
        if (!ok) {
            this.hooks.warn("Не удалось сменить качество демки");
            return;
        }
        saveQuality(q);
        this.set({ screenQuality: q });
        await session.setScreenQuality(q);
    }

    private onSignal(m: SignalMsg, ctx: PeerCtx) {
        switch (m.type) {
            case "ring":
                this.dispatch({ type: "ring", callId: m.callId, peerId: ctx.peerId, channelId: ctx.channelId, video: !!m.video });
                return;
            case "accept": this.dispatch({ type: "remote-accept", callId: m.callId }); return;
            case "decline": this.dispatch({ type: "remote-decline", callId: m.callId, reason: m.reason === "busy" ? "busy" : "declined" }); return;
            case "bye": this.dispatch({ type: "remote-bye", callId: m.callId }); return;
            case "tun": this.onTun(m); return;
            case "offer": case "answer": case "ice": {
                const { call } = this.v;
                if (!("callId" in call) || m.callId !== call.callId) return;
                const s: OutSignal = m.type === "ice" ? { type: "ice", candidate: m.candidate ?? null } : { type: m.type, sdp: m.sdp! };
                if (this.session) this.session.handle(s).catch(e => console.error("[P2PCall] signal", e));
                else this.pendingSignals.push(s);
            }
        }
    }

    private dispatch(e: CallEvent) {
        const prev = this.v.call;
        const { state, effects } = reduce(prev, e);
        if (state === prev && !effects.length) return;
        if (state !== prev) this.set({ call: state });
        for (const fx of effects) this.run(fx);
        // звонящий — сразу, принимающий — только после «Принять»: входящий звонок не открывает порт на роутере
        if ((state.phase === "outgoing" || state.phase === "connecting") && this.tun?.callId !== state.callId) this.prepareTunnel(state.callId);
        if (prev.phase !== "incoming" && state.phase === "incoming") this.hooks.onIncoming();
        if (isMissedCall(prev, state)) this.hooks.info("Пропущенный P2P-звонок");
        if (state.phase === "ended" && state !== this.resetFor) {
            this.resetFor = state;
            clearTimeout(this.resetTimer);
            this.resetTimer = setTimeout(() => this.dispatch({ type: "reset" }), ENDED_SHOW_MS);
        }
    }

    private run(fx: Effect) {
        switch (fx.kind) {
            case "join-room": this.sig?.joinCall(fx.peer.callId, fx.peer); return;
            case "leave-room":
                this.sig?.leaveCall(fx.callId);
                if (fx.callId === this.tun?.callId) this.closeTunnel();
                return;
            case "send-ring":
                this.sig?.send(fx.peer, fx.peer.callId, { type: "ring", channelId: fx.peer.channelId, video: fx.video });
                return;
            case "send":
                this.sig?.send(fx.peer, fx.peer.callId, fx.msg);
                return;
            case "start-timer": {
                const sec = fx.which === "ring" ? settings.store.ringTimeoutSec : settings.store.iceTimeoutSec;
                this.timers.push(setTimeout(() => this.dispatch({ type: "timeout", which: fx.which, callId: fx.callId }), sec * 1000));
                return;
            }
            case "clear-timers":
                this.timers.forEach(clearTimeout);
                this.timers = [];
                return;
            case "ringtone": fx.on ? startRingtone() : stopRingtone(); return;
            case "offer-fallback": {
                // UPnP при «не ответил» ни при чём — подсказка только когда не пробилось соединение
                const net = fx.reason === "ice-timeout" || fx.reason === "ice-failed";
                this.hooks.offerFallback(fx.channelId, net ? tunnelHint(this.lastTun) : null);
                return;
            }
            case "start-session": this.startSession(fx.peer, fx.video); return;
            case "stop-session": this.stopSession(); return;
        }
    }

    private async startSession(peer: Peer, video: boolean) {
        this.peer = peer;
        this.iceRestarted = false;

        // микрофон до сессии: первый offer сразу несёт звук — нет второго раунда переговоров
        let mic: MediaStream | null = null;
        try {
            mic = await getMic(settings.store.inputDevice);
        } catch (e) {
            this.hooks.warn("Микрофон недоступен: " + (e as Error).message);
            this.audioState = { ...this.audioState, mic: false };
        }
        if (this.peer !== peer) { mic?.getTracks().forEach(t => t.stop()); return; }

        const session = new Session(isPolite(this.selfId, peer.peerId), {
            signal: m => this.sig?.send(peer, peer.callId, m.type === "ice" ? { type: "ice", candidate: m.candidate } : { type: m.type, sdp: m.sdp }),
            remoteMedia: (kind, stream) => this.onRemote(kind, stream),
            iceState: st => this.onIce(st),
        }, { ownCaps: this.ownCaps, codec: () => settings.store.screenCodec as CodecChoice });
        this.session = session;
        this.sendTun();
        this.linkTunnel();
        if (mic) {
            // пользователь мог выключить микрофон, пока шёл захват
            mic.getAudioTracks().forEach(t => { t.enabled = this.audioState.mic; });
            this.mic = mic;
            await session.setTrack("mic", mic);
            // пока ставился трек, звонок могли завершить — тогда ничего не запускаем
            if (this.session !== session) return;
            this.selfMeter?.stop();
            this.selfMeter = new LevelMeter(this.ctx(), mic,
                self => this.set({ speaking: { ...this.v.speaking, self } }),
                () => this.audioState.mic && !this.audioState.deafened);
        }
        this.applyAudio();
        for (const s of this.pendingSignals.splice(0)) session.handle(s).catch(e => console.error("[P2PCall] signal", e));

        this.statsTimer = setInterval(async () => {
            if (this.session !== session) return;
            this.set({ stats: await session.stats() });
        }, 1000);

        this.diagTimer = setInterval(() => {
            if (this.session !== session || this.v.call.phase !== "connected" || !settings.store.diagLog || !this.v.stats) return;
            console.info("[P2PCall] stats", JSON.stringify({ ...compactStats(this.v.stats), screenCodec: session.screenCodec(), quality: this.v.screenQuality, capture: captureInfo(this.v.local.screen), encoder: session.screenEncoding() }));
            if (this.tun) Native.tunnelStatus(this.tun.callId).then(st => { if (st) console.info("[P2PCall] tunnel", JSON.stringify(st)); }, () => { });
        }, 5000);

        if (video && this.session === session) await this.toggleCam();
    }

    private stopSession() {
        clearInterval(this.statsTimer);
        clearInterval(this.diagTimer);
        this.screenSource = null;
        this.capturedQuality = null;
        this.session?.close();
        this.session = null;
        this.peer = null;
        this.pendingSignals = [];
        this.mic = null;
        this.audio?.pause();
        this.audio = null;
        this.selfMeter?.stop();
        this.peerMeter?.stop();
        this.selfMeter = this.peerMeter = null;
        this.audioCtx?.close().catch(() => { });
        this.audioCtx = null;
        this.audioState = INITIAL_AUDIO;
        this.set({ remote: {}, local: NO_LOCAL, deafened: false, speaking: NOT_SPEAKING, stats: null });
    }

    /**
     * Туннель для собеседников за общим CGNAT (specs/001-udp-tunnel-upnp). Готовится, пока идёт вызов;
     * ошибки только в лог — без туннеля звонок ведёт себя как раньше.
     */
    private prepareTunnel(callId: string) {
        this.closeTunnel();
        const t: CallTunnel = { callId, info: null, sent: false, peer: null, linked: false };
        this.tun = t;
        Native.tunnelPrepare(callId).then(info => {
            if (this.tun !== t) return;
            t.info = info;
            console.info("[P2PCall] tunnel", JSON.stringify(info ? { addr: info.addr, upnp: info.upnp, upnpCode: info.upnpCode, lanIp: info.lanIp, proxyPort: info.proxyPort } : { failed: true }));
            this.sendTun();
            this.linkTunnel();
        }, e => console.warn("[P2PCall] tunnel", e));
    }

    /** Свой адрес — собеседнику, как только есть и туннель, и сессия */
    private sendTun() {
        const t = this.tun, { peer } = this;
        if (!t?.info || t.sent || !this.session || peer?.callId !== t.callId) return;
        t.sent = true;
        this.sig?.send(peer, t.callId, { type: "tun", addr: t.info.addr, token: t.info.token, upnp: t.info.upnp, upnpCode: t.info.upnpCode });
    }

    private onTun(m: SignalMsg) {
        const t = this.tun;
        if (!t || m.callId !== t.callId || typeof m.token !== "string") return;
        t.peer = { addr: typeof m.addr === "string" ? m.addr : null, token: m.token, upnp: typeof m.upnp === "string" ? m.upnp : "error", upnpCode: typeof m.upnpCode === "number" ? m.upnpCode : null };
        console.info("[P2PCall] tunnel peer", JSON.stringify({ addr: t.peer.addr, upnp: t.peer.upnp, upnpCode: t.peer.upnpCode }));
        this.linkTunnel();
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

    private closeTunnel() {
        const t = this.tun;
        if (!t) return;
        this.tun = null;
        this.lastTun = t;
        // итог туннеля в лог до закрытия — у несостоявшегося звонка другого следа не будет
        const { call } = this.v;
        Native.tunnelStatus(t.callId).then(st => console.info("[P2PCall] tunnel end", JSON.stringify({
            end: call.phase === "ended" ? call.reason : call.phase, own: t.info?.upnp ?? null, peer: t.peer?.upnp ?? null, linked: t.linked, status: st,
        })), () => { });
        Native.tunnelClose(t.callId).catch(() => { });
    }

    private onRemote(kind: TrackKind, stream: MediaStream | null) {
        // remoteMedia может прийти дважды для одного потока (ontrack и метки kinds) — второй раз ничего не делаем
        if (kind === "mic" && stream !== this.peerMeter?.stream) {
            this.audio?.pause();
            this.audio = stream ? playStream(stream, settings.store.outputDevice) : null;
            if (this.audio) this.audio.muted = this.audioState.deafened;
            this.peerMeter?.stop();
            this.peerMeter = stream
                ? new LevelMeter(this.ctx(), stream, peer => this.set({ speaking: { ...this.v.speaking, peer } }), () => true)
                : null;
            if (!stream) this.set({ speaking: { ...this.v.speaking, peer: false } });
        }
        const remote = { ...this.v.remote };
        if (stream) remote[kind] = stream; else delete remote[kind];
        this.set({ remote });
    }

    private ctx() {
        return this.audioCtx ??= new AudioContext();
    }

    private onIce(st: RTCIceConnectionState) {
        if (st === "connected" || st === "completed") this.dispatch({ type: "ice-connected" });
        else if (st === "disconnected" && !this.iceRestarted) { this.iceRestarted = true; this.session?.restartIce(); }
        else if (st === "failed") this.dispatch({ type: "ice-failed" });
    }
}
