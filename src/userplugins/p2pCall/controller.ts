/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { newCallId, pairHint } from "./crypto";
import { getCamera, getMic, getScreen, playStream } from "./media";
import { startRingtone, stopRingtone } from "./ringtone";
import { OutSignal, ScreenHint, Session, TrackKind } from "./session";
import { relayList, settings } from "./settings";
import { PeerCtx, Signaling,SignalMsg } from "./signaling";
import { CallEvent, CallState, Effect, isPolite, Peer, reduce } from "./state";
import { CallStats } from "./stats";

export interface View {
    call: CallState;
    relaysUp: number;
    remote: Partial<Record<TrackKind, MediaStream>>;
    local: { mic: boolean; cam: MediaStream | null; screen: MediaStream | null; };
    stats: CallStats | null;
    hint: ScreenHint;
}

interface Hooks {
    offerFallback(channelId: string): void;
    warn(text: string): void;
    inVoiceChannel(): boolean;
    dmPeers(): PeerCtx[];
}

const ENDED_SHOW_MS = 3000;
const NO_LOCAL: View["local"] = { mic: true, cam: null, screen: null };

export class CallController {
    private v: View = { call: { phase: "idle" }, relaysUp: 0, remote: {}, local: NO_LOCAL, stats: null, hint: "motion" };
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
    private hints = new Map<string, PeerCtx>();

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
    accept() { this.dispatch({ type: "accept" }); }
    decline() { this.dispatch({ type: "decline" }); }
    hangup() { this.dispatch({ type: "hangup" }); }

    toggleMic() {
        const on = !this.v.local.mic;
        this.mic?.getAudioTracks().forEach(t => { t.enabled = on; });
        this.set({ local: { ...this.v.local, mic: on } });
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

    async startScreen(sourceId: string) {
        const { session } = this;
        if (!session) return;
        try {
            const screen = await getScreen(sourceId);
            if (this.session !== session) { screen.getTracks().forEach(t => t.stop()); return; }
            screen.getVideoTracks()[0].onended = () => { this.stopScreen(); };
            await session.setTrack("screen", screen);
            this.set({ local: { ...this.v.local, screen } });
        } catch (e) {
            this.hooks.warn("Не удалось захватить экран: " + (e as Error).message);
        }
    }

    async stopScreen() {
        if (!this.session || !this.v.local.screen) return;
        await this.session.setTrack("screen", null);
        this.set({ local: { ...this.v.local, screen: null } });
    }

    async setHint(h: ScreenHint) {
        this.set({ hint: h });
        await this.session?.setScreenHint(h);
    }

    private onSignal(m: SignalMsg, ctx: PeerCtx) {
        switch (m.type) {
            case "ring":
                this.dispatch({ type: "ring", callId: m.callId, peerId: ctx.peerId, channelId: ctx.channelId, video: !!m.video });
                return;
            case "accept": this.dispatch({ type: "remote-accept", callId: m.callId }); return;
            case "decline": this.dispatch({ type: "remote-decline", callId: m.callId, reason: m.reason === "busy" ? "busy" : "declined" }); return;
            case "bye": this.dispatch({ type: "remote-bye", callId: m.callId }); return;
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
        const { state, effects } = reduce(this.v.call, e);
        if (state === this.v.call && !effects.length) return;
        if (state !== this.v.call) this.set({ call: state });
        for (const fx of effects) this.run(fx);
        if (state.phase === "ended" && state !== this.resetFor) {
            this.resetFor = state;
            clearTimeout(this.resetTimer);
            this.resetTimer = setTimeout(() => this.dispatch({ type: "reset" }), ENDED_SHOW_MS);
        }
    }

    private run(fx: Effect) {
        switch (fx.kind) {
            case "join-room": this.sig?.joinCall(fx.peer.callId, fx.peer); return;
            case "leave-room": this.sig?.leaveCall(fx.callId); return;
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
            case "offer-fallback": this.hooks.offerFallback(fx.channelId); return;
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
        }
        if (this.peer !== peer) { mic?.getTracks().forEach(t => t.stop()); return; }

        const session = new Session(isPolite(this.selfId, peer.peerId), {
            signal: m => this.sig?.send(peer, peer.callId, m.type === "ice" ? { type: "ice", candidate: m.candidate } : { type: m.type, sdp: m.sdp }),
            remoteMedia: (kind, stream) => this.onRemote(kind, stream),
            iceState: st => this.onIce(st),
        }, settings.store.screenMaxBitrateMbps * 1_000_000);
        this.session = session;
        if (mic) {
            // пользователь мог выключить микрофон, пока шёл захват
            mic.getAudioTracks().forEach(t => { t.enabled = this.v.local.mic; });
            this.mic = mic;
            await session.setTrack("mic", mic);
        }
        for (const s of this.pendingSignals.splice(0)) session.handle(s).catch(e => console.error("[P2PCall] signal", e));

        this.statsTimer = setInterval(async () => {
            if (this.session !== session) return;
            this.set({ stats: await session.stats() });
        }, 1000);

        if (video && this.session === session) await this.toggleCam();
    }

    private stopSession() {
        clearInterval(this.statsTimer);
        this.session?.close();
        this.session = null;
        this.peer = null;
        this.pendingSignals = [];
        this.mic = null;
        this.audio?.pause();
        this.audio = null;
        this.set({ remote: {}, local: NO_LOCAL, stats: null });
    }

    private onRemote(kind: TrackKind, stream: MediaStream | null) {
        if (kind === "mic") {
            this.audio?.pause();
            this.audio = stream ? playStream(stream, settings.store.outputDevice) : null;
        }
        const remote = { ...this.v.remote };
        if (stream) remote[kind] = stream; else delete remote[kind];
        this.set({ remote });
    }

    private onIce(st: RTCIceConnectionState) {
        if (st === "connected" || st === "completed") this.dispatch({ type: "ice-connected" });
        else if (st === "disconnected" && !this.iceRestarted) { this.iceRestarted = true; this.session?.restartIce(); }
        else if (st === "failed") this.dispatch({ type: "ice-failed" });
    }
}
