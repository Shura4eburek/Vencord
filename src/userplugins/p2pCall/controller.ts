/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { hexToBytes } from "@noble/hashes/utils";
import { PluginNative } from "@utils/types";

import { CodecChoice, probeCaps } from "./codecs";
import { newCallId } from "./crypto";
import { compactStats } from "./diagLog";
import { Group, initiator, isAlone, isFull, isMember, join, leave, MemberKey, members, mergeRoster, newGroup, parseRoster, routeRing, stale, STALE_MS, toWire } from "./group";
import { LevelMeter } from "./levelMeter";
import { LinkTracks, PeerLink, tunnelHint } from "./link";
import { INITIAL_AUDIO, LocalAudio, toggleDeafenState, toggleMicState } from "./localAudio";
import { getCamera, getMic, getScreen } from "./media";
import type { PakeMsg } from "./pairing";
import { startRingtone, stopRingtone } from "./ringtone";
import { OutSignal, TrackKind } from "./session";
import { relayList, savedQuality, saveQuality, settings } from "./settings";
import { PairKey, PeerCtx, Signaling, SignalMsg } from "./signaling";
import { CallEvent, CallState, Effect, EndReason, isActive, isMissedCall, Peer, reduce } from "./state";
import { CallStats } from "./stats";
import { needsRecapture, StreamQuality, trackConstraints } from "./streamQuality";
import { contactsChanged } from "./ui/Contacts";

export { tunnelHint };

const Native = VencordNative.pluginHelpers.P2PCall as PluginNative<typeof import("./native")>;

/** Участник звонка (кроме себя) для интерфейса */
export interface MemberView {
    userId: string;
    by: string;
    /** Фаза связи с ним; null — связи нет (ещё не установлена или пропала) */
    phase: CallState["phase"] | null;
    remote: Partial<Record<TrackKind, MediaStream>>;
    speaking: boolean;
    micOff: boolean;
    deafened: boolean;
    stats: CallStats | null;
}

/** Входящий вызов: первый или во время звонка (specs/004-group-calls US1) */
export interface InviteView {
    linkId: string;
    from: string;
    channelId: string;
    video: boolean;
    /** Участники группы, в которую зовут (без себя), — если звонок групповой */
    members: string[];
    /** Почему «Добавить сюда» недоступна; null — доступна */
    addBlocked: string | null;
}

export interface View {
    /** Сводная фаза звонка: вызов, соединение, идёт, завершён */
    call: CallState;
    inCall: boolean;
    relaysUp: number;
    members: MemberView[];
    invites: InviteView[];
    /** ЛС, в которых виден звонок: с каждым участником, с кем ЛС есть */
    channels: string[];
    local: { mic: boolean; cam: MediaStream | null; screen: MediaStream | null; };
    deafened: boolean;
    speaking: { self: boolean; };
    /** Статистика первой соединённой связи — для чипа и плашки */
    stats: CallStats | null;
    screenQuality: StreamQuality;
}

interface Hooks {
    offerFallback(channelId: string, hint: string | null): void;
    warn(text: string): void;
    inVoiceChannel(): boolean;
    dmPeers(): PeerCtx[];
    profile(userId: string): { name: string; avatar: string | null; };
    /** У известного контакта новый ключ: новое устройство или подмена — звонки с ним ждут подтверждения */
    newKey(userId: string): void;
    onIncoming(linkId: string): void;
    info(text: string): void;
}

const ENDED_SHOW_MS = 3000;
const KEY_WAIT_MS = 8000;
const TICK_MS = 1000;
const HERE_EVERY_MS = 5000;
/** Связь внутри группы: повтор ring, пока у собеседника нет нашего ключа (R5) */
const AUTO_RING_EVERY_MS = 2000;
const AUTO_RING_FOR_MS = 15_000;
const AUTO_RETRY_MS = 5000;
const CAPS = ["group"];
const FALLBACK: EndReason[] = ["no-answer", "ice-timeout", "ice-failed"];

/** Что реально выдал захват: разрешение и FPS по настройкам трека — сравнить с выбранным качеством */
function captureInfo(stream: MediaStream | null) {
    const s = stream?.getVideoTracks()[0]?.getSettings();
    return s ? `${s.width}x${s.height}@${Math.round(s.frameRate ?? 0)} ${s.displaySurface ?? "legacy"}` : null;
}

const NO_LOCAL: View["local"] = { mic: true, cam: null, screen: null };
const stopStream = (s: MediaStream | null) => s?.getTracks().forEach(t => t.stop());

export class CallController {
    private v: View = {
        call: { phase: "idle" }, inCall: false, relaysUp: 0, members: [], invites: [], channels: [], local: NO_LOCAL,
        deafened: false, speaking: { self: false }, stats: null, screenQuality: savedQuality(),
    };
    private listeners = new Set<() => void>();
    private sig: Signaling | null = null;
    private links = new Map<string, PeerLink>();
    private group: Group | null = null;
    private inCall = false;
    /** Завершённый звонок показывается ENDED_SHOW_MS */
    private ended: Extract<CallState, { phase: "ended"; }> | null = null;
    private resetTimer: ReturnType<typeof setTimeout> | undefined;
    private tickTimer: ReturnType<typeof setInterval> | undefined;
    private diagTimer: ReturnType<typeof setInterval> | undefined;
    private lastHereSent = 0;
    private lastHere = new Map<string, number>();
    private autoTried = new Map<string, number>();
    /** Ключи из intro, чей участник ещё не появился в составе */
    private pendingIntros = new Map<string, { via: string; key: MemberKey; }>();
    private knownCaps = new Map<string, string[]>();
    private dmChannels = new Map<string, string>();
    private ringing = false;
    private leaving = false;
    private refreshQueued = false;

    private mic: MediaStream | null = null;
    private micReady: Promise<MediaStream | null> | null = null;
    private camBusy = false;
    private ownCaps = probeCaps().then(c => { console.info("[P2PCall] codecs", JSON.stringify(c)); return c; });
    private screenSource: string | null = null;
    private capturedQuality: StreamQuality | null = null;
    private qualityQueue: Promise<void> = Promise.resolve();
    private audioState: LocalAudio = INITIAL_AUDIO;
    private audioCtx: AudioContext | null = null;
    private selfMeter: LevelMeter | null = null;

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
            onMessage: (m, ctx) => this.onSignal(m, ctx),
            onStatus: n => this.set({ relaysUp: n }),
            onPake: m => this.onPake(m),
            onMutual: k => { Native.contactMutual(k.userId, k.deviceId).then(() => this.refreshKeys(), () => { }); },
        });
        this.sig.start();
        contactsChanged.add(this.onContactsChanged);
        // ключи и контакты. Обмен — только при открытии ЛС и звонке: рассылка по всем ЛС при старте выдавала бы
        // релеям, с кем у тебя есть переписка (pake1 несёт ID отправителя открытым текстом)
        Native.pairingInit(this.selfId)
            .then(() => this.refreshKeys())
            .catch(e => console.warn("[P2PCall] keys", e));
    }

    stop() {
        this.hangup();
        for (const l of [...this.links.values()]) this.dispatchLink(l, { type: "hangup" });
        clearTimeout(this.resetTimer);
        clearInterval(this.tickTimer);
        clearInterval(this.diagTimer);
        stopRingtone();
        contactsChanged.delete(this.onContactsChanged);
        this.sig?.stop();
        this.sig = null;
    }

    /** Открыт ЛС — повод обменяться ключами, если ещё не обменялись */
    openedChannel(channelId: string) {
        const p = this.hooks.dmPeers().find(x => x.channelId === channelId);
        if (p) this.startPairing(p);
    }

    private onContactsChanged = () => { this.refreshKeys().catch(() => { }); };

    private refreshKeys() {
        return Native.pairKeys().then(list => {
            const keys: PairKey[] = list.map(k => ({ ...k, key: hexToBytes(k.key) }));
            this.sig?.setPairKeys(keys);
        });
    }

    /** force — звонок: не ждать 10 мин с прошлой попытки (у Pairing свой короткий предел) */
    private startPairing(p: PeerCtx, force = false) {
        const profile = this.hooks.profile(p.peerId);
        // имя и аватар контакта — свежие из Discord, пока он доступен (файл пишется только при изменении)
        Native.contactProfile(p.peerId, profile.name, profile.avatar).catch(() => { });
        Native.pairingStart(p.peerId, { channelId: p.channelId, ...profile }, force)
            .then(m => { if (m) this.sig?.sendPake(p.peerId, m); }, () => { });
    }

    /** ЛС с отправителем — пароль обмена; без ЛС main сообщение игнорирует */
    private onPake(m: PakeMsg) {
        const p = this.hooks.dmPeers().find(x => x.peerId === m.from);
        const peer = p ? { channelId: p.channelId, ...this.hooks.profile(p.peerId) } : null;
        Native.pairingHandle(m, peer).then(async r => {
            if (r.added) {
                console.info("[P2PCall] keys", JSON.stringify({ peer: r.added.userId, result: r.added.result }));
                if (r.added.result === "pending") this.hooks.newKey(r.added.userId);
                // сначала свой ключ пары, потом pake3/pairok: ответ собеседника на ключе пары не потеряется
                await this.refreshKeys();
            }
            for (const out of r.send) this.sig?.sendPake(m.from, out);
            // ответчик завершил обмен — сообщаем инициатору, что ключ взаимный
            if (r.added && m.type === "pake3") this.sig?.sendPairOk(m.from);
        }).catch(e => console.warn("[P2PCall] keys", e));
    }

    /**
     * Без ключа пары звонить нечем (прежней схемы нет): сначала обмен ключами, до KEY_WAIT_MS. Не вышло —
     * у собеседника старая версия P2PCall или он не в сети
     */
    private async ensureKey(channelId: string, peerId: string) {
        if (this.sig?.hasKey(peerId)) return true;
        this.startPairing({ channelId, peerId }, true);
        const deadline = Date.now() + KEY_WAIT_MS;
        while (!this.sig?.hasKey(peerId) && Date.now() < deadline) await new Promise(r => setTimeout(r, 250));
        if (this.sig?.hasKey(peerId)) return true;
        this.hooks.warn("Нет ключа P2P с собеседником: у него старая версия P2PCall или он не в сети");
        return false;
    }

    /** Звонок из ЛС. Во время звонка — приглашение в него (specs/004-group-calls US2) */
    async dial(channelId: string, peerId: string, video: boolean) {
        if (this.inCall) return this.invite(channelId, peerId);
        if (this.primary()) return;
        if (!await this.ensureKey(channelId, peerId)) return;
        if (this.inCall || this.primary()) return;
        if (this.hooks.inVoiceChannel()) this.hooks.warn("Ты сейчас в голосовом канале Discord — он продолжит работать параллельно");
        this.ended = null;
        const link = this.newLink(newCallId(), peerId, channelId);
        this.dispatchLink(link, { type: "dial", ...link.peer, video });
    }

    /** Позвать в идущий звонок: ring с составом и ключами участников */
    async invite(channelId: string, peerId: string) {
        const block = this.addBlocked(peerId);
        if (block) { this.hooks.warn(block); return; }
        if (!await this.ensureKey(channelId, peerId)) return;
        const keys = await this.memberKeys([peerId]);
        // за время ожидания звонок мог закончиться или он уже добавлен
        if (!this.inCall || !this.group || this.linkOf(peerId) || this.addBlocked(peerId)) return;
        const link = this.newLink(newCallId(), peerId, channelId);
        link.inviteOut = true;
        link.ringExtra = { group: { id: this.group.id, roster: toWire(this.group) }, keys };
        this.dispatchLink(link, { type: "dial", ...link.peer, video: false });
    }

    /** Принять первый входящий (не во время звонка) */
    accept(linkId: string, video = false) {
        const link = this.links.get(linkId);
        if (!link || link.state.phase !== "incoming") return;
        if (this.hooks.inVoiceChannel()) this.hooks.warn("Идут два звонка: P2P и Discord");
        link.invite = false;
        this.dispatchLink(link, { type: "accept", video });
    }

    decline(linkId: string) {
        const link = this.links.get(linkId);
        if (link?.state.phase === "incoming") this.dispatchLink(link, { type: "decline" });
    }

    /** «Положить текущий и принять» */
    replaceWith(linkId: string) {
        const link = this.links.get(linkId);
        if (!link || link.state.phase !== "incoming") return;
        this.leaveGroup(linkId, false);
        this.accept(linkId);
    }

    /** «Добавить сюда»: входящий становится участником текущего звонка */
    async addHere(linkId: string) {
        const link = this.links.get(linkId);
        if (!link || link.state.phase !== "incoming" || !this.group || this.addBlocked(link.userId, link)) return;
        const keys = await this.memberKeys([link.userId]);
        if (!this.group || !this.links.has(linkId) || link.state.phase !== "incoming") return;
        const g = join(this.group, link.userId, this.selfId, Date.now());
        if (!g) return;
        this.setGroup(g);
        link.invite = false;
        link.acceptExtra = { group: { id: this.group.id, roster: toWire(this.group) }, keys };
        this.dispatchLink(link, { type: "accept", video: false });
        this.introduceToOthers(link);
        this.broadcastRoster();
    }

    hangup() {
        if (this.inCall) { this.leaveGroup(null, true); return; }
        const p = this.primary();
        if (p) this.dispatchLink(p, { type: "hangup" });
    }

    // ── Медиа ──

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
        for (const l of this.links.values()) l.setDeafened(deafened);
        this.set({ local: { ...this.v.local, mic }, deafened });
        this.sendAudio([...this.links.values()]);
    }

    /** Свой микрофон и звук — собеседникам для бейджа на плитке */
    private sendAudio(links: PeerLink[]) {
        const { mic, deafened } = this.audioState;
        for (const l of links) if (l.state.phase === "connected" || l.state.phase === "connecting") this.sig?.send(l.peer, l.linkId, { type: "audio", mic, deaf: deafened });
    }

    private sessions() {
        return [...this.links.values()].filter(l => l.session);
    }

    private async setTrackAll(kind: TrackKind, stream: MediaStream | null) {
        await Promise.all(this.sessions().map(l => l.session!.setTrack(kind, stream)));
    }

    async toggleCam() {
        // повторный клик, пока камера включается, не должен захватить вторую
        if (!this.inCall || this.camBusy) return;
        this.camBusy = true;
        try {
            const old = this.v.local.cam;
            if (old) {
                this.set({ local: { ...this.v.local, cam: null } });
                await this.setTrackAll("cam", null);
                stopStream(old);
                return;
            }
            const cam = await getCamera(settings.store.cameraDevice);
            if (!this.inCall) { stopStream(cam); return; }
            this.set({ local: { ...this.v.local, cam } });
            await this.setTrackAll("cam", cam);
        } catch (e) {
            this.hooks.warn("Камера недоступна: " + (e as Error).message);
        } finally {
            this.camBusy = false;
        }
    }

    async startScreen(sourceId: string, q: StreamQuality) {
        if (!this.inCall) return;
        saveQuality(q);
        this.set({ screenQuality: q });
        try {
            const screen = await getScreen(sourceId, q);
            if (!this.inCall) { stopStream(screen); return; }
            screen.getVideoTracks()[0].onended = () => { this.stopScreen(); };
            this.screenSource = sourceId;
            this.capturedQuality = q;
            this.set({ local: { ...this.v.local, screen } });
            await this.setTrackAll("screen", screen);
            await this.applyReceivers();
        } catch (e) {
            this.hooks.warn("Не удалось захватить экран: " + (e as Error).message);
        }
    }

    async stopScreen() {
        const old = this.v.local.screen;
        if (!old) return;
        this.screenSource = null;
        this.capturedQuality = null;
        this.set({ local: { ...this.v.local, screen: null } });
        await this.setTrackAll("screen", null);
        stopStream(old);
    }

    /** Смена качества на ходу. Строго по очереди — иначе параллельные перезахваты теряют треки */
    setScreenQuality(q: StreamQuality): Promise<void> {
        const run = this.qualityQueue.then(() => this.applyScreenQuality(q));
        this.qualityQueue = run.catch(() => { });
        return run;
    }

    /** Понижение — applyConstraints; повышение (или отказ applyConstraints) — новый захват того же источника */
    private async applyScreenQuality(q: StreamQuality) {
        const stream = this.v.local.screen;
        if (!stream || !this.capturedQuality) {
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
                if (this.v.local.screen !== stream) { stopStream(fresh); return; }
                const t = fresh.getVideoTracks()[0];
                t.onended = () => { this.stopScreen(); };
                await Promise.all(this.sessions().map(l => l.session!.replaceScreenTrack(t)));
                // общий MediaStream всех связей: id потока у собеседников не меняется
                for (const old of stream.getVideoTracks()) { stream.removeTrack(old); old.stop(); }
                stream.addTrack(t);
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
        await this.applyReceivers();
    }

    /** Потолок демки делится на всех получателей (R9) */
    private async applyReceivers() {
        const list = this.sessions();
        await Promise.all(list.map(l => l.session!.setScreenQuality(this.v.screenQuality, list.length)));
    }

    private tracks(): LinkTracks {
        return { mic: this.mic, cam: this.v.local.cam, screen: this.v.local.screen, quality: this.v.screenQuality, receivers: this.sessions().length + 1 };
    }

    private ctx() {
        return this.audioCtx ??= new AudioContext();
    }

    /** Микрофон захватывается один раз на звонок и уходит во все связи */
    private ensureMic() {
        if (this.micReady) return this.micReady;
        const ready: Promise<MediaStream | null> = getMic(settings.store.inputDevice).then(mic => {
            // захват от прошлого звонка, закончившегося, пока он шёл, — не наш
            if (!this.inCall || this.micReady !== ready) { stopStream(mic); return null; }
            // пользователь мог выключить микрофон, пока шёл захват
            this.useMic(mic);
            return mic;
        }, e => {
            this.hooks.warn("Микрофон недоступен: " + (e as Error).message);
            if (this.micReady === ready) this.audioState = { ...this.audioState, mic: false };
            return null;
        });
        return this.micReady = ready;
    }

    private useMic(mic: MediaStream) {
        mic.getAudioTracks().forEach(t => { t.enabled = this.audioState.mic; });
        this.mic = mic;
        this.selfMeter?.stop();
        this.selfMeter = new LevelMeter(this.ctx(), mic,
            self => this.set({ speaking: { self } }),
            () => this.audioState.mic && !this.audioState.deafened);
    }

    /** Смена устройства, в том числе посреди звонка (specs/005-call-redesign contracts/ui.md) */
    async setDevice(kind: MediaDeviceKind, id: string) {
        // настройка сохраняется после удачного захвата: сбойное устройство не становится выбором по умолчанию
        const save = () => {
            if (kind === "audioinput") settings.store.inputDevice = id;
            else if (kind === "audiooutput") settings.store.outputDevice = id;
            else settings.store.cameraDevice = id;
        };
        if (!this.inCall) { save(); return; }
        try {
            if (kind === "audiooutput") {
                save();
                for (const l of this.links.values()) l.setOutput(id);
            } else if (kind === "videoinput") {
                const old = this.v.local.cam;
                if (!old || this.camBusy) { save(); return; }
                const cam = await getCamera(id);
                save();
                // за время захвата камеру могли выключить или звонок закончиться
                if (!this.inCall || this.v.local.cam !== old) { stopStream(cam); return; }
                this.set({ local: { ...this.v.local, cam } });
                // старый захват гасим и при сбое части связей — иначе камера остаётся включённой
                try { await this.setTrackAll("cam", cam); } finally { stopStream(old); }
            } else {
                const old = this.mic;
                if (!old) { save(); return; }
                const mic = await getMic(id);
                save();
                if (!this.inCall || this.mic !== old) { stopStream(mic); return; }
                this.useMic(mic);
                this.micReady = Promise.resolve(mic);
                try { await this.setTrackAll("mic", mic); } finally { stopStream(old); }
            }
            console.info("[P2PCall] device", kind, id || "default");
        } catch (e) {
            console.warn("[P2PCall] device", kind, e);
            this.hooks.warn("Устройство недоступно: " + (e as Error).message);
        }
    }

    /** Почему человека нельзя добавить в текущий звонок; null — можно */
    canAdd(userId: string): string | null {
        if (!this.inCall) return null;
        if (this.linkOf(userId)) return "Уже в звонке";
        return this.addBlocked(userId);
    }

    private async startLink(link: PeerLink, video: boolean) {
        await this.ensureMic();
        if (!this.links.has(link.linkId)) return;
        this.applyAudio();
        await link.start(() => this.tracks());
        this.applyReceivers().catch(() => { });
        if (video && !this.v.local.cam) await this.toggleCam();
    }

    private stopLocalMedia() {
        stopStream(this.mic);
        stopStream(this.v.local.cam);
        stopStream(this.v.local.screen);
        this.mic = null;
        this.micReady = null;
        this.screenSource = null;
        this.capturedQuality = null;
        this.selfMeter?.stop();
        this.selfMeter = null;
        this.audioCtx?.close().catch(() => { });
        this.audioCtx = null;
        this.audioState = INITIAL_AUDIO;
        this.set({ local: NO_LOCAL, deafened: false, speaking: { self: false } });
    }

    // ── Связи ──

    private newLink(linkId: string, peerId: string, channelId: string) {
        const link = new PeerLink(linkId, { callId: linkId, peerId, channelId }, {
            selfId: this.selfId,
            send: (l, body) => this.sig?.send(l.peer, l.linkId, body),
            ownCaps: this.ownCaps,
            codec: () => settings.store.screenCodec as CodecChoice,
            outputDevice: () => settings.store.outputDevice,
            deafened: () => this.audioState.deafened,
            audioCtx: () => this.ctx(),
            iceState: (l, st) => this.onIce(l, st),
            changed: () => this.queueRefresh(),
        });
        this.links.set(linkId, link);
        return link;
    }

    private linkOf(userId: string) {
        for (const l of this.links.values()) if (l.userId === userId && isActive(l.state)) return l;
        return null;
    }

    /** Вызов не во время звонка: звоним мы или звонят нам */
    private primary() {
        for (const l of this.links.values()) if (!l.invite && !l.auto && !l.inviteOut && isActive(l.state)) return l;
        return null;
    }

    private dispatchLink(link: PeerLink, e: CallEvent) {
        const prev = link.state;
        const { state, effects } = reduce(prev, e);
        if (state === prev && !effects.length) return;
        link.state = state;
        if (state.phase !== prev.phase) console.info("[P2PCall] link", JSON.stringify({ link: link.linkId, peer: link.userId, phase: state.phase, reason: state.phase === "ended" ? state.reason : undefined, auto: link.auto, invite: link.invite || link.inviteOut }));
        for (const fx of effects) this.runLink(link, fx);
        // звонящий — сразу, принимающий — только после «Принять»: входящий звонок не открывает порт на роутере
        if (state.phase === "outgoing" || state.phase === "connecting") link.prepareTunnel();
        if (prev.phase !== "incoming" && state.phase === "incoming" && !link.auto) this.hooks.onIncoming(link.linkId);
        if (!link.auto && isMissedCall(prev, state)) this.hooks.info("Пропущенный P2P-звонок");
        if (prev.phase !== "connecting" && state.phase === "connecting") this.onLinkUp(link);
        if (state.phase === "ended" && prev.phase !== "ended") this.onLinkEnded(link, state.reason);
        this.syncRingtone();
        this.refresh();
    }

    private runLink(link: PeerLink, fx: Effect) {
        switch (fx.kind) {
            case "join-room": this.sig?.joinCall(link.linkId, link.peer); return;
            case "leave-room":
                this.sig?.leaveCall(link.linkId);
                link.closeTunnel();
                return;
            case "send-ring":
                link.lastRingAt = Date.now();
                this.sig?.send(link.peer, link.linkId, { type: "ring", channelId: link.peer.channelId, video: fx.video, caps: CAPS, ...link.ringExtra });
                return;
            case "send":
                this.sig?.send(link.peer, link.linkId, fx.msg.type === "accept" ? { ...fx.msg, caps: CAPS, ...link.acceptExtra } : fx.msg);
                return;
            case "start-timer": {
                const sec = fx.which === "ring" ? settings.store.ringTimeoutSec : settings.store.iceTimeoutSec;
                link.timers.push(setTimeout(() => this.dispatchLink(link, { type: "timeout", which: fx.which, callId: fx.callId }), sec * 1000));
                return;
            }
            case "clear-timers":
                link.timers.forEach(clearTimeout);
                link.timers = [];
                return;
            // рингтон один на все входящие — syncRingtone; подсказка UPnP — в onLinkEnded, когда ясно, закончился ли звонок
            case "ringtone": case "offer-fallback": return;
            case "start-session": this.startLink(link, fx.video); return;
            case "stop-session": link.stopSession(); return;
        }
    }

    private syncRingtone() {
        const on = [...this.links.values()].some(l => l.state.phase === "incoming" && !l.auto);
        if (on === this.ringing) return;
        this.ringing = on;
        on ? startRingtone() : stopRingtone();
    }

    /** Связь соединяется: первый звонок создаёт группу, остальные вступают в неё */
    private onLinkUp(link: PeerLink) {
        const now = Date.now();
        this.lastHere.set(link.userId, now);
        if (!this.inCall) {
            this.inCall = true;
            this.ended = null;
            clearTimeout(this.resetTimer);
            const jg = link.joinGroup;
            const roster = jg && parseRoster(jg.roster);
            if (jg && roster && typeof jg.id === "string") {
                // нас позвали в групповой звонок (или добавили к нему): состав — от позвавшего
                const g: Group = { id: jg.id, startedAt: now, entries: [{ userId: this.selfId, joinedAt: now, by: link.userId }], tombs: [] };
                const merged = mergeRoster(g, roster);
                this.setGroup(isMember(merged, link.userId) ? merged : join(merged, link.userId, link.userId, now) ?? merged);
            } else {
                // звонок вдвоём: группа из двух, добавил тот, кто звонил
                const g = newGroup(link.linkId, this.selfId, now);
                this.setGroup(join(g, link.userId, link.lastRingAt ? this.selfId : link.userId, now) ?? g);
            }
            // ключи только участников этого состава — не «чей угодно ключ от имени кого угодно»
            const keys = (link.joinKeys ?? []).filter(k => k && isMember(this.group!, k.userId));
            if (keys.length) this.introduce(link.userId, keys);
            this.startTicking();
            console.info("[P2PCall] group", JSON.stringify({ id: this.group!.id, members: members(this.group!).map(m => m.userId) }));
        } else if (link.inviteOut && this.group) {
            // позвали в идущий звонок, он принял: старая версия без групп — только звонок вдвоём
            if (!link.groupCapable) {
                this.hooks.warn(`У ${this.hooks.profile(link.userId).name} старая версия P2PCall — групповые звонки не поддерживаются`);
                this.dispatchLink(link, { type: "hangup" });
                return;
            }
            const g = join(this.group, link.userId, this.selfId, now);
            if (!g) { this.dispatchLink(link, { type: "hangup" }); return; }
            this.setGroup(g);
            // дальше это обычная связь участника: уход по составу закрывает её, как остальные
            link.inviteOut = false;
            this.introduceToOthers(link);
        }
        this.sendRoster(link);
        this.broadcastRoster();
    }

    private onLinkEnded(link: PeerLink, reason: EndReason) {
        this.links.delete(link.linkId);
        link.close();
        if (this.leaving) return;
        if (this.inCall) this.applyReceivers().catch(() => { });
        if (!this.inCall) {
            // первый вызов не состоялся
            if (link.invite || link.auto || link.inviteOut) return;
            this.showEnded({ phase: "ended", reason, peerId: link.userId, channelId: link.peer.channelId });
            if (FALLBACK.includes(reason)) this.hooks.offerFallback(link.peer.channelId, null);
            return;
        }
        if (link.invite) return;
        if (link.inviteOut && !(this.group && isMember(this.group, link.userId))) {
            if (reason === "declined" || reason === "busy" || reason === "no-answer") this.hooks.info(`${this.hooks.profile(link.userId).name} не принял приглашение`);
            return;
        }
        const g = this.group;
        if (!g || !isMember(g, link.userId)) { this.checkAlone(reason); return; }
        const others = members(g).filter(m => m.userId !== this.selfId);
        // вдвоём — как раньше: сброс или потеря связи завершают звонок
        if (others.length === 1) {
            this.setGroup(leave(g, link.userId, Date.now()));
            this.endCall(reason, link);
            return;
        }
        // в группе bye — ушёл; обрыв связи — участник остаётся, связь восстановит инициатор (R7)
        if (reason === "remote-hangup") this.dropMember(link.userId);
        this.checkAlone(reason);
    }

    private onIce(link: PeerLink, st: RTCIceConnectionState) {
        if (st === "connected" || st === "completed") {
            this.dispatchLink(link, { type: "ice-connected" });
            this.sendAudio([link]);
        }
        else if (st === "failed") this.dispatchLink(link, { type: "ice-failed" });
    }

    // ── Группа ──

    private setGroup(g: Group | null) {
        const before = this.group ? members(this.group).map(m => m.userId) : [];
        this.group = g;
        const after = g ? members(g).map(m => m.userId) : [];
        const now = Date.now();
        for (const u of after) if (!this.lastHere.has(u)) this.lastHere.set(u, now);
        for (const [u, pi] of this.pendingIntros) {
            if (!after.includes(u)) continue;
            this.pendingIntros.delete(u);
            if (g && isMember(g, pi.via)) this.introduce(pi.via, [pi.key]);
        }
        if (g && before.length > 1) {
            const name = (u: string) => this.hooks.profile(u).name;
            for (const u of after) if (!before.includes(u) && u !== this.selfId) this.hooks.info(`${name(u)} теперь в звонке`);
            // вдвоём уход собеседника — это конец звонка, его покажет область звонка
            if (before.length > 2) for (const u of before) if (!after.includes(u) && u !== this.selfId) this.hooks.info(`${name(u)} вышел из звонка`);
        }
        if (before.join() !== after.join()) {
            const dm = new Map(this.hooks.dmPeers().map(p => [p.peerId, p.channelId]));
            this.dmChannels = dm;
            if (g) console.info("[P2PCall] group", JSON.stringify({ id: g.id, members: after }));
        }
    }

    /** Участник ушёл или пропал: надгробие, его связь закрыть */
    private dropMember(userId: string) {
        if (!this.group || !isMember(this.group, userId)) return;
        this.setGroup(leave(this.group, userId, Date.now()));
        this.lastHere.delete(userId);
        const l = this.linkOf(userId);
        if (l && !l.invite) this.dispatchLink(l, { type: "remote-bye", callId: l.linkId });
        this.broadcastRoster();
    }

    private checkAlone(reason: EndReason) {
        if (this.inCall && this.group && isAlone(this.group, this.selfId)) this.endCall(reason === "hangup" ? "remote-hangup" : reason, null);
    }

    /** Звонок закончился: связи, медиа, состав — всё сбросить, показать итог */
    private endCall(reason: EndReason, last: PeerLink | null) {
        const { call } = this.v;
        const peerId = last?.userId ?? ("peerId" in call ? call.peerId : "");
        const channelId = last?.peer.channelId ?? ("channelId" in call ? call.channelId : "");
        this.leaveGroup(null, false);
        this.showEnded({ phase: "ended", reason, peerId, channelId });
        if (FALLBACK.includes(reason)) {
            const net = reason === "ice-timeout" || reason === "ice-failed";
            this.hooks.offerFallback(channelId, net ? tunnelHint(last?.lastTun ?? last?.tun ?? null) : null);
        }
    }

    /** Выйти из звонка: leave всем, связи закрыть (кроме except — его примут следом) */
    private leaveGroup(except: string | null, show: boolean) {
        const g = this.group;
        const first = g && members(g).find(m => m.userId !== this.selfId);
        this.leaving = true;
        try {
            for (const l of [...this.links.values()]) {
                if (l.linkId === except) continue;
                if (g && (l.state.phase === "connecting" || l.state.phase === "connected") && l.groupCapable) this.sig?.send(l.peer, l.linkId, { type: "leave", groupId: g.id });
                this.dispatchLink(l, l.state.phase === "incoming" ? { type: "decline" } : { type: "hangup" });
            }
        } finally {
            this.leaving = false;
        }
        this.inCall = false;
        this.group = null;
        this.lastHere.clear();
        this.autoTried.clear();
        this.pendingIntros.clear();
        clearInterval(this.tickTimer);
        clearInterval(this.diagTimer);
        this.tickTimer = this.diagTimer = undefined;
        this.stopLocalMedia();
        if (show && first) this.showEnded({ phase: "ended", reason: "hangup", peerId: first.userId, channelId: this.dmChannels.get(first.userId) ?? "" });
        this.refresh();
    }

    private showEnded(s: Extract<CallState, { phase: "ended"; }>) {
        this.ended = s;
        clearTimeout(this.resetTimer);
        this.resetTimer = setTimeout(() => { if (this.ended === s) { this.ended = null; this.refresh(); } }, ENDED_SHOW_MS);
        this.refresh();
    }

    /** Связи групповые, если у всех участников версия с группами */
    private addBlocked(userId: string, link?: PeerLink): string | null {
        if (!this.group) return null;
        if (isMember(this.group, userId) && !link) return "Уже в звонке";
        // он зовёт нас в свой групповой звонок — два звонка в один не сливаем
        if (link?.joinGroup && link.joinGroup.id !== this.group.id) return "Собеседник зовёт в свой групповой звонок";
        if (isFull(this.group) && !isMember(this.group, userId)) return "В звонке уже 5 человек";
        const old = members(this.group).find(m => m.userId !== this.selfId && !this.linkOf(m.userId)?.groupCapable && !(this.knownCaps.get(m.userId) ?? []).includes("group"));
        if (old) return `У ${this.hooks.profile(old.userId).name} старая версия P2PCall — групповые звонки не поддерживаются`;
        const caps = link ? link.caps : this.knownCaps.get(userId);
        if (caps && !caps.includes("group")) return `У ${this.hooks.profile(userId).name} старая версия P2PCall — групповые звонки не поддерживаются`;
        return null;
    }

    /** Ключи участников (кроме себя и except) — для того, кого добавляем */
    private async memberKeys(except: string[]): Promise<MemberKey[]> {
        if (!this.group) return [];
        const list = members(this.group).filter(m => m.userId !== this.selfId && !except.includes(m.userId));
        const keys = await Promise.all(list.map(m => Native.memberKey(m.userId, this.linkOf(m.userId)?.deviceId ?? null).catch(() => null)));
        return list.flatMap((m, i) => {
            const k = keys[i];
            return k ? [{ userId: m.userId, ...this.hooks.profile(m.userId), ...k }] : [];
        });
    }

    /** Новый участник link — остальным: его ключ, чтобы они могли с ним связаться (R4) */
    private async introduceToOthers(link: PeerLink) {
        const k = await Native.memberKey(link.userId, link.deviceId).catch(() => null);
        if (!k || !this.group) return;
        const key: MemberKey = { userId: link.userId, ...this.hooks.profile(link.userId), ...k };
        for (const l of this.links.values()) {
            if (l === link || !l.groupCapable || (l.state.phase !== "connecting" && l.state.phase !== "connected")) continue;
            this.sig?.send(l.peer, l.linkId, { type: "intro", groupId: this.group.id, key });
        }
    }

    private introduce(via: string, keys: MemberKey[]) {
        Native.contactIntroduce(via, keys).then(async res => {
            for (const r of res) if (r.result === "pending") this.hooks.newKey(r.userId);
            if (res.length) console.info("[P2PCall] keys", JSON.stringify({ via, introduced: res }));
            await this.refreshKeys();
            this.ensureLinks();
        }).catch(e => console.warn("[P2PCall] keys", e));
    }

    private sendRoster(l: PeerLink) {
        if (!this.group || !l.groupCapable || (l.state.phase !== "connecting" && l.state.phase !== "connected")) return;
        this.sig?.send(l.peer, l.linkId, { type: "roster", group: { id: this.group.id, roster: toWire(this.group) } });
    }

    private broadcastRoster() {
        for (const l of this.links.values()) this.sendRoster(l);
    }

    private onRoster(link: PeerLink, m: SignalMsg) {
        const g = this.group;
        const roster = parseRoster(m.group?.roster);
        if (!g || !roster || m.group?.id !== g.id || !isMember(g, link.userId)) return;
        let next = mergeRoster(g, roster);
        if (next === g) return;
        // нас сочли пропавшими, а мы в звонке — вступаем заново, позже надгробия
        if (!isMember(next, this.selfId)) {
            const t = next.tombs.find(x => x.userId === this.selfId)?.leftAt ?? 0;
            next = { ...next, entries: [...next.entries.filter(e => e.userId !== this.selfId), { userId: this.selfId, joinedAt: Math.max(Date.now(), t + 1), by: this.selfId }] };
        }
        const changed = JSON.stringify(toWire(next)) !== JSON.stringify(toWire(g));
        this.setGroup(next);
        for (const l of [...this.links.values()]) if (!l.invite && !l.inviteOut && !isMember(next, l.userId)) this.dispatchLink(l, { type: "remote-bye", callId: l.linkId });
        if (changed) this.broadcastRoster();
        this.ensureLinks();
        this.checkAlone("remote-hangup");
    }

    /** Связи с участниками, которых ещё нет: начинает меньший ID, повтор с паузой (R5) */
    private ensureLinks() {
        const g = this.group;
        if (!this.inCall || !g) return;
        const now = Date.now();
        for (const m of members(g)) {
            if (m.userId === this.selfId || this.linkOf(m.userId) || initiator(this.selfId, m.userId) !== this.selfId) continue;
            if (!this.sig?.hasKey(m.userId) || now - (this.autoTried.get(m.userId) ?? 0) < AUTO_RETRY_MS) continue;
            this.autoTried.set(m.userId, now);
            const link = this.newLink(newCallId(), m.userId, this.dmChannels.get(m.userId) ?? "");
            link.auto = true;
            link.ringExtra = { auto: true, group: { id: g.id, roster: toWire(g) } };
            this.dispatchLink(link, { type: "dial", ...link.peer, video: false });
        }
    }

    private startTicking() {
        clearInterval(this.tickTimer);
        this.tickTimer = setInterval(() => this.tick(), TICK_MS);
        clearInterval(this.diagTimer);
        this.diagTimer = setInterval(() => this.diag(), 5000);
    }

    private tick() {
        const g = this.group;
        if (!this.inCall || !g) return;
        const now = Date.now();
        // живая связь — участник на месте, даже если он на версии без here; повисшую закроет таймаут ICE
        for (const l of this.links.values()) if ((l.state.phase === "connecting" || l.state.phase === "connected") && isMember(g, l.userId)) this.lastHere.set(l.userId, now);
        this.lastHere.set(this.selfId, now);
        if (now - this.lastHereSent >= HERE_EVERY_MS) {
            this.lastHereSent = now;
            const seen: [string, number][] = [...this.lastHere].filter(([u, at]) => u !== this.selfId && now - at < STALE_MS).map(([u, at]) => [u, now - at]);
            for (const l of this.links.values()) {
                if (l.groupCapable && (l.state.phase === "connecting" || l.state.phase === "connected")) this.sig?.send(l.peer, l.linkId, { type: "here", groupId: g.id, seen });
            }
        }
        for (const l of [...this.links.values()]) {
            if (!l.auto || l.state.phase !== "outgoing") continue;
            if (now - l.createdAt > AUTO_RING_FOR_MS) this.dispatchLink(l, { type: "timeout", which: "ring", callId: l.linkId });
            else if (now - l.lastRingAt >= AUTO_RING_EVERY_MS) this.runLink(l, { kind: "send-ring", peer: l.peer, video: false });
        }
        for (const u of stale(g, this.selfId, this.lastHere, now)) {
            console.info("[P2PCall] group", JSON.stringify({ stale: u }));
            this.dropMember(u);
        }
        this.ensureLinks();
        this.checkAlone("remote-hangup");
    }

    private onHere(link: PeerLink, m: SignalMsg) {
        const g = this.group;
        if (!g || m.groupId !== g.id || !isMember(g, link.userId)) return;
        const now = Date.now();
        this.lastHere.set(link.userId, now);
        if (!Array.isArray(m.seen)) return;
        for (const s of m.seen.slice(0, 8)) {
            if (!Array.isArray(s) || typeof s[0] !== "string" || typeof s[1] !== "number" || s[0] === this.selfId || !isMember(g, s[0])) continue;
            const at = now - Math.max(0, s[1]);
            if (at > (this.lastHere.get(s[0]) ?? 0)) this.lastHere.set(s[0], at);
        }
    }

    private diag() {
        if (!settings.store.diagLog) return;
        for (const l of this.links.values()) {
            if (l.state.phase !== "connected" || !l.stats || !l.session) continue;
            console.info("[P2PCall] stats", JSON.stringify({ link: l.linkId, peer: l.userId, ...compactStats(l.stats), screenCodec: l.session.screenCodec(), quality: this.v.screenQuality, capture: captureInfo(this.v.local.screen), encoder: l.session.screenEncoding() }));
            if (l.tun) Native.tunnelStatus(l.tun.callId).then(st => { if (st) console.info("[P2PCall] tunnel", JSON.stringify({ link: l.linkId, ...st })); }, () => { });
        }
    }

    // ── Сигналинг ──

    private onSignal(m: SignalMsg, ctx: PeerCtx) {
        if (Array.isArray(m.caps) && (m.type === "ring" || m.type === "accept")) this.knownCaps.set(ctx.peerId, m.caps.filter(c => typeof c === "string"));
        if (m.type === "ring") { this.onRing(m, ctx); return; }
        const link = this.links.get(m.callId);
        if (!link || link.userId !== ctx.peerId) return;
        if (ctx.deviceId) link.deviceId = ctx.deviceId;
        switch (m.type) {
            case "accept":
                link.caps = this.knownCaps.get(ctx.peerId) ?? [];
                if (m.group && !this.inCall) { link.joinGroup = m.group; link.joinKeys = Array.isArray(m.keys) ? m.keys : []; }
                this.dispatchLink(link, { type: "remote-accept", callId: m.callId });
                return;
            case "decline": this.dispatchLink(link, { type: "remote-decline", callId: m.callId, reason: m.reason === "busy" ? "busy" : "declined" }); return;
            case "bye": this.dispatchLink(link, { type: "remote-bye", callId: m.callId }); return;
            case "tun": link.onTun(m); return;
            case "offer": case "answer": case "ice": {
                if (!isActive(link.state)) return;
                const s: OutSignal = m.type === "ice" ? { type: "ice", candidate: m.candidate ?? null } : { type: m.type, sdp: m.sdp! };
                link.handleSignal(s);
                return;
            }
            case "roster": this.onRoster(link, m); return;
            case "here": this.onHere(link, m); return;
            case "intro":
                if (!this.group || m.groupId !== this.group.id || !isMember(this.group, link.userId) || !m.key || typeof m.key.userId !== "string") return;
                // ключ — только участника состава; состав может прийти позже ключа — тогда ждём его
                if (isMember(this.group, m.key.userId)) this.introduce(link.userId, [m.key]);
                else this.pendingIntros.set(m.key.userId, { via: link.userId, key: m.key });
                return;
            case "leave":
                if (this.group && m.groupId === this.group.id) this.dropMember(link.userId);
                return;
            case "audio":
                link.remoteAudio = { mic: m.mic !== false, deaf: m.deaf === true };
                this.queueRefresh();
                return;
        }
    }

    private onRing(m: SignalMsg, ctx: PeerCtx) {
        const same = this.links.get(m.callId);
        if (same) { if (same.userId === ctx.peerId) this.dispatchLink(same, { type: "ring", callId: m.callId, peerId: ctx.peerId, channelId: ctx.channelId, video: !!m.video }); return; }
        // тот же собеседник с новым callId — он перезапустил Discord, старая связь у него мертва;
        // встречный дозвон (мы ему звоним) — «занят»
        const old = this.linkOf(ctx.peerId);
        if (old) {
            if (old.state.phase === "outgoing" && !old.auto && !m.auto) { this.sendBusy(m.callId, ctx); return; }
            if (this.inCall && !m.auto && this.group && !old.invite && isMember(this.group, old.userId) && members(this.group).length <= 2) {
                // вдвоём — как раньше: старый звонок завершается, новый звонит
                this.leaveGroup(null, false);
            } else {
                // в группе участник остаётся в составе: его новый вызов — приглашение с «Добавить сюда»;
                // повисшее приглашение от него же просто заменяется новым
                this.leaving = true;
                try { this.dispatchLink(old, { type: "remote-bye", callId: old.linkId }); } finally { this.leaving = false; }
            }
        }
        const route = routeRing({ inCall: this.inCall, ringing: !!this.primary(), group: this.group, from: ctx.peerId, auto: !!m.auto, ringGroupId: m.group?.id });
        if (route === "busy") { this.sendBusy(m.callId, ctx); return; }
        const link = this.newLink(m.callId, ctx.peerId, ctx.channelId);
        if (ctx.deviceId) link.deviceId = ctx.deviceId;
        link.caps = Array.isArray(m.caps) ? m.caps : [];
        link.auto = route === "auto-accept";
        link.invite = route === "invite";
        // зовут в чужой групповой звонок: состав и ключи применятся, если примем (в т.ч. «Положить текущий и принять»)
        if (m.group) { link.joinGroup = m.group; link.joinKeys = Array.isArray(m.keys) ? m.keys : []; }
        if (route === "primary") this.ended = null;
        this.dispatchLink(link, { type: "ring", callId: m.callId, peerId: ctx.peerId, channelId: ctx.channelId, video: !!m.video });
        if (link.auto) this.dispatchLink(link, { type: "accept", video: false });
    }

    private sendBusy(callId: string, ctx: PeerCtx) {
        const peer: Peer = { callId, peerId: ctx.peerId, channelId: ctx.channelId };
        this.sig?.joinCall(callId, peer);
        this.sig?.send(peer, callId, { type: "decline", reason: "busy" });
        this.sig?.leaveCall(callId);
    }

    // ── Вид ──

    private remoteAudio(l: PeerLink | null) {
        return { micOff: !!l && !l.remoteAudio.mic, deafened: !!l && l.remoteAudio.deaf };
    }

    private queueRefresh() {
        if (this.refreshQueued) return;
        this.refreshQueued = true;
        queueMicrotask(() => { this.refreshQueued = false; this.refresh(); });
    }

    private refresh() {
        const g = this.group;
        const list: MemberView[] = [];
        if (this.inCall && g) {
            for (const m of members(g)) {
                if (m.userId === this.selfId) continue;
                const l = this.linkOf(m.userId);
                list.push({ userId: m.userId, by: m.by, phase: l && !l.invite ? l.state.phase : null, remote: l?.remote ?? {}, speaking: l?.speaking ?? false, ...this.remoteAudio(l), stats: l?.stats ?? null });
            }
        } else {
            const p = this.primary();
            if (p && p.state.phase !== "incoming") list.push({ userId: p.userId, by: this.selfId, phase: p.state.phase, remote: p.remote, speaking: p.speaking, ...this.remoteAudio(p), stats: p.stats });
        }

        const invites: InviteView[] = [];
        for (const l of this.links.values()) {
            if (l.state.phase !== "incoming" || l.auto) continue;
            const roster = l.joinGroup && parseRoster(l.joinGroup.roster);
            invites.push({
                linkId: l.linkId, from: l.userId, channelId: l.peer.channelId, video: l.state.video,
                members: roster ? members(roster).map(m => m.userId).filter(u => u !== this.selfId) : [],
                addBlocked: this.inCall ? this.addBlocked(l.userId, l) : null,
            });
        }

        let call: CallState;
        if (this.inCall && g) {
            const first = list.find(m => m.phase) ?? list[0];
            const peerId = first?.userId ?? "";
            const channelId = this.dmChannels.get(peerId) ?? this.linkOf(peerId)?.peer.channelId ?? "";
            const connected = list.some(m => m.phase === "connected");
            call = { phase: connected ? "connected" : "connecting", callId: g.id, peerId, channelId };
        } else {
            const p = this.primary();
            call = p ? p.state : this.ended ?? { phase: "idle" };
        }

        const channels = new Set<string>();
        if (this.inCall) for (const m of list) {
            const ch = this.dmChannels.get(m.userId) ?? this.linkOf(m.userId)?.peer.channelId;
            if (ch) channels.add(ch);
        }
        // нет ЛС ни с кем из участников — в ЛС с тем, кто добавил
        if (this.inCall && !channels.size && g) {
            const self = g.entries.find(e => e.userId === this.selfId);
            const ch = self && this.dmChannels.get(self.by);
            if (ch) channels.add(ch);
        }
        if ("channelId" in call && call.channelId) channels.add(call.channelId);

        const stats = list.find(m => m.phase === "connected" && m.stats)?.stats ?? null;
        this.set({ call, inCall: this.inCall, members: list, invites, channels: [...channels], stats });
    }
}
