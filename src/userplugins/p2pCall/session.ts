/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Caps, chooseCodec, CodecChoice, isCaps, orderCodecs } from "./codecs";
import { DEFAULT_OPUS, tuneOpus, tuneVideo } from "./sdp";
import { CallStats, Counters, summarizeStats } from "./stats";
import { DEFAULT_QUALITY, encoderParams, StreamQuality } from "./streamQuality";

export type TrackKind = "mic" | "cam" | "screen";
export type OutSignal = { type: "offer" | "answer"; sdp: string; } | { type: "ice"; candidate: RTCIceCandidateInit | null; };
export interface SessionCallbacks {
    signal(m: OutSignal): void;
    remoteMedia(kind: TrackKind, stream: MediaStream | null): void;
    iceState(state: RTCIceConnectionState): void;
}

export const ICE_SERVERS: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
];

export interface SessionOptions { ownCaps: Promise<Caps>; codec: () => CodecChoice; }
const tuneSdp = (sdp: string) => tuneVideo(tuneOpus(sdp, DEFAULT_OPUS));

/** Perfect negotiation: входящий offer конфликтует с нашим, если мы не готовы его принять */
export function offerCollides(makingOffer: boolean, state: RTCSignalingState, settingRemoteAnswer: boolean): boolean {
    const ready = !makingOffer && (state === "stable" || settingRemoteAnswer);
    return !ready;
}

export class Session {
    private pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: "max-bundle" });
    private ctl: RTCDataChannel;
    private makingOffer = false;
    private ignoreOffer = false;
    private settingRemoteAnswer = false;
    private queue: Promise<void> = Promise.resolve();
    private senders = new Map<TrackKind, RTCRtpSender>();
    private local = new Map<TrackKind, MediaStream>();
    private remoteKinds = new Map<string, TrackKind>();
    private remoteStreams = new Map<string, MediaStream>();
    private quality: StreamQuality = DEFAULT_QUALITY;
    private own: Caps | null = null;
    private peer: Caps | null = null;
    private chosen: string | null = null;
    private codecChoice: () => CodecChoice;
    private prev?: Counters;

    constructor(private polite: boolean, private cb: SessionCallbacks, opts: SessionOptions) {
        this.codecChoice = opts.codec;
        this.ctl = this.pc.createDataChannel("ctl", { negotiated: true, id: 0 });
        this.ctl.onopen = () => { this.sendKinds(); this.sendCaps(); };
        opts.ownCaps.then(c => { this.own = c; this.sendCaps(); });
        this.ctl.onmessage = e => this.onCtl(e.data);

        this.pc.onnegotiationneeded = async () => {
            try {
                this.makingOffer = true;
                await this.pc.setLocalDescription();
                const d = this.pc.localDescription!;
                this.cb.signal({ type: d.type as "offer", sdp: tuneSdp(d.sdp) });
            } catch (e) {
                console.error("[P2PCall] negotiation", e);
            } finally {
                this.makingOffer = false;
            }
        };
        this.pc.onicecandidate = e => this.cb.signal({ type: "ice", candidate: e.candidate?.toJSON() ?? null });
        this.pc.oniceconnectionstatechange = () => this.cb.iceState(this.pc.iceConnectionState);
        this.pc.ontrack = e => {
            if ("jitterBufferTarget" in e.receiver) (e.receiver as any).jitterBufferTarget = 0;
            const stream = e.streams[0];
            if (!stream) return;
            this.remoteStreams.set(stream.id, stream);
            stream.onremovetrack = () => {
                if (stream.getTracks().length) return;
                const kind = this.remoteKinds.get(stream.id);
                this.remoteStreams.delete(stream.id);
                if (kind) this.cb.remoteMedia(kind, null);
            };
            this.emitRemote(stream.id);
        };
    }

    async setTrack(kind: TrackKind, stream: MediaStream | null) {
        const old = this.senders.get(kind);
        if (old) {
            this.pc.removeTrack(old);
            this.senders.delete(kind);
        }
        this.local.get(kind)?.getTracks().forEach(t => t.stop());
        this.local.delete(kind);
        if (stream) {
            const track = stream.getTracks()[0];
            this.local.set(kind, stream);
            const sender = this.pc.addTrack(track, stream);
            this.senders.set(kind, sender);
            if (kind === "screen") {
                const tr = this.pc.getTransceivers().find(t => t.sender === sender);
                this.chosen = chooseCodec(this.codecChoice(), this.own, this.peer);
                const caps = RTCRtpReceiver.getCapabilities("video")?.codecs ?? [];
                tr?.setCodecPreferences(orderCodecs(caps, this.chosen));
                await this.applyScreenParams();
            }
        }
        this.sendKinds();
    }

    async setScreenQuality(q: StreamQuality) {
        this.quality = q;
        await this.applyScreenParams();
    }

    /** Новый трек захвата в тот же MediaStream: id потока у собеседника не меняется, пересогласование не нужно */
    async replaceScreenTrack(track: MediaStreamTrack) {
        const sender = this.senders.get("screen");
        const stream = this.local.get("screen");
        if (!sender || !stream) { track.stop(); return; }
        const old = stream.getVideoTracks()[0];
        await sender.replaceTrack(track);
        if (old) { stream.removeTrack(old); old.stop(); }
        stream.addTrack(track);
        await this.applyScreenParams();
    }

    screenCodec() { return this.senders.has("screen") ? this.chosen : null; }

    private async applyScreenParams() {
        const sender = this.senders.get("screen");
        if (!sender?.track) return;
        const e = encoderParams(this.quality);
        sender.track.contentHint = e.contentHint;
        const p = sender.getParameters();
        if (!p.encodings?.length) p.encodings = [{}];
        p.encodings[0].maxBitrate = e.maxBitrate;
        p.encodings[0].maxFramerate = e.maxFramerate;
        (p as any).degradationPreference = e.degradationPreference;
        await sender.setParameters(p).catch(err => console.warn("[P2PCall] setParameters", err));
    }

    /** Сигналы обрабатываются строго по очереди: иначе offer проверяется на коллизию посреди применения answer */
    handle(m: OutSignal): Promise<void> {
        const run = this.queue.then(() => this.apply(m));
        this.queue = run.catch(() => { });
        return run;
    }

    private async apply(m: OutSignal) {
        if (m.type === "ice") {
            try {
                await this.pc.addIceCandidate(m.candidate ?? undefined);
            } catch (e) {
                if (!this.ignoreOffer) console.warn("[P2PCall] ice", e);
            }
            return;
        }
        const collision = m.type === "offer" && offerCollides(this.makingOffer, this.pc.signalingState, this.settingRemoteAnswer);
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        this.settingRemoteAnswer = m.type === "answer";
        try {
            await this.pc.setRemoteDescription({ type: m.type, sdp: m.sdp });
        } finally {
            this.settingRemoteAnswer = false;
        }
        if (m.type === "offer") {
            await this.pc.setLocalDescription();
            this.cb.signal({ type: "answer", sdp: tuneSdp(this.pc.localDescription!.sdp) });
        }
    }

    restartIce() {
        this.pc.restartIce();
    }

    async stats(): Promise<CallStats> {
        const report = await this.pc.getStats();
        const s = summarizeStats(report.values(), performance.now(), this.prev);
        this.prev = s.counters;
        return s;
    }

    close() {
        for (const s of this.local.values()) s.getTracks().forEach(t => t.stop());
        this.local.clear();
        this.ctl.close();
        this.pc.close();
    }

    private sendKinds() {
        if (this.ctl.readyState !== "open") return;
        const kinds: Record<string, TrackKind> = {};
        for (const [kind, stream] of this.local) kinds[stream.id] = kind;
        this.ctl.send(JSON.stringify({ type: "kinds", kinds }));
    }

    private sendCaps() {
        if (this.ctl.readyState !== "open" || !this.own) return;
        this.ctl.send(JSON.stringify({ type: "caps", ...this.own }));
    }

    private onCtl(data: string) {
        let m: { type?: string; kinds?: Record<string, TrackKind>; encodeHw?: unknown; decodeHw?: unknown; };
        try { m = JSON.parse(data); } catch { return; }
        if (m.type === "caps") {
            const caps = { encodeHw: m.encodeHw, decodeHw: m.decodeHw };
            if (isCaps(caps)) this.peer = caps;
            return;
        }
        if (m.type !== "kinds" || !m.kinds) return;
        const before = new Map(this.remoteKinds);
        this.remoteKinds = new Map(Object.entries(m.kinds));
        for (const [id, kind] of before) if (!this.remoteKinds.has(id)) this.cb.remoteMedia(kind, null);
        for (const id of this.remoteKinds.keys()) this.emitRemote(id);
    }

    private emitRemote(streamId: string) {
        const kind = this.remoteKinds.get(streamId);
        const stream = this.remoteStreams.get(streamId);
        if (kind && stream) this.cb.remoteMedia(kind, stream);
    }
}
