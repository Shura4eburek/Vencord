/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DEFAULT_OPUS, tuneOpus } from "./sdp";
import { CallStats, Counters, summarizeStats } from "./stats";

export type TrackKind = "mic" | "cam" | "screen";
export type ScreenHint = "motion" | "detail";
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

const VIDEO_ORDER = ["video/VP9", "video/H264"];

export class Session {
    private pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: "max-bundle" });
    private ctl: RTCDataChannel;
    private makingOffer = false;
    private ignoreOffer = false;
    private senders = new Map<TrackKind, RTCRtpSender>();
    private local = new Map<TrackKind, MediaStream>();
    private remoteKinds = new Map<string, TrackKind>();
    private remoteStreams = new Map<string, MediaStream>();
    private hint: ScreenHint = "motion";
    private prev?: Counters;

    constructor(private polite: boolean, private cb: SessionCallbacks, private screenMaxBitrate: number) {
        this.ctl = this.pc.createDataChannel("ctl", { negotiated: true, id: 0 });
        this.ctl.onopen = () => this.sendKinds();
        this.ctl.onmessage = e => this.onCtl(e.data);

        this.pc.onnegotiationneeded = async () => {
            try {
                this.makingOffer = true;
                await this.pc.setLocalDescription();
                const d = this.pc.localDescription!;
                this.cb.signal({ type: d.type as "offer", sdp: tuneOpus(d.sdp, DEFAULT_OPUS) });
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
                const caps = RTCRtpReceiver.getCapabilities("video")?.codecs ?? [];
                const rank = (m: string) => { const i = VIDEO_ORDER.indexOf(m); return i < 0 ? VIDEO_ORDER.length : i; };
                tr?.setCodecPreferences([...caps].sort((a, b) => rank(a.mimeType) - rank(b.mimeType)));
                await this.applyScreenParams();
            }
        }
        this.sendKinds();
    }

    async setScreenHint(hint: ScreenHint) {
        this.hint = hint;
        await this.applyScreenParams();
    }

    private async applyScreenParams() {
        const sender = this.senders.get("screen");
        if (!sender?.track) return;
        sender.track.contentHint = this.hint;
        const p = sender.getParameters();
        if (!p.encodings?.length) p.encodings = [{}];
        p.encodings[0].maxBitrate = this.screenMaxBitrate;
        (p as any).degradationPreference = this.hint === "motion" ? "maintain-framerate" : "maintain-resolution";
        await sender.setParameters(p).catch(e => console.warn("[P2PCall] setParameters", e));
    }

    async handle(m: OutSignal) {
        if (m.type === "ice") {
            try {
                await this.pc.addIceCandidate(m.candidate ?? undefined);
            } catch (e) {
                if (!this.ignoreOffer) console.warn("[P2PCall] ice", e);
            }
            return;
        }
        const collision = m.type === "offer" && (this.makingOffer || this.pc.signalingState !== "stable");
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        await this.pc.setRemoteDescription({ type: m.type, sdp: m.sdp });
        if (m.type === "offer") {
            await this.pc.setLocalDescription();
            this.cb.signal({ type: "answer", sdp: tuneOpus(this.pc.localDescription!.sdp, DEFAULT_OPUS) });
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

    private onCtl(data: string) {
        let m: { type?: string; kinds?: Record<string, TrackKind>; };
        try { m = JSON.parse(data); } catch { return; }
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
