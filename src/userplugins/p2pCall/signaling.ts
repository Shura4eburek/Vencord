/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";

import { deriveKey, newMsgId, open, pairHint, seal, topicCall, topicLine } from "./crypto";
import { NostrEvent, RelayConn, WsFactory } from "./relay";

export const KIND = 25050;
export const MAX_AGE_MS = 30_000;

export type SignalType = "ring" | "accept" | "decline" | "offer" | "answer" | "ice" | "bye";
export interface SignalMsg {
    type: SignalType; msgId: string; callId: string; from: string; ts: number;
    channelId?: string; video?: boolean; sdp?: string; candidate?: RTCIceCandidateInit | null; reason?: string;
}
export interface PeerCtx { channelId: string; peerId: string; }
export interface SignalingOptions {
    selfId: string;
    relays: string[];
    ws: WsFactory;
    resolvePair(hint: string): PeerCtx | null;
    onMessage(msg: SignalMsg, ctx: PeerCtx): void;
    onStatus(upCount: number): void;
    now?: () => number;
}

const LINE_SUB = "line";
const tag = (ev: NostrEvent, name: string) => ev.tags.find(t => t[0] === name)?.[1];

export class Signaling {
    private relays: RelayConn[];
    private sk = generateSecretKey();
    private lineTopic: string;
    private rooms = new Map<string, { ctx: PeerCtx; topic: string; }>();
    private seen = new Map<string, number>();
    private keys = new Map<string, Uint8Array>();
    private now: () => number;

    constructor(private o: SignalingOptions) {
        this.now = o.now ?? Date.now;
        this.lineTopic = topicLine(o.selfId);
        this.relays = o.relays.map(url => new RelayConn(url, o.ws, ev => this.onEvent(ev), () => this.reportStatus()));
    }

    start() {
        const filter = { kinds: [KIND], "#t": [this.lineTopic] };
        for (const r of this.relays) { r.subscribe(LINE_SUB, filter); r.start(); }
    }

    stop() {
        for (const r of this.relays) r.stop();
        this.rooms.clear();
    }

    joinCall(callId: string, ctx: PeerCtx) {
        const topic = topicCall(callId);
        this.rooms.set(callId, { ctx, topic });
        for (const r of this.relays) r.subscribe(callId, { kinds: [KIND], "#t": [topic] });
    }

    leaveCall(callId: string) {
        this.rooms.delete(callId);
        for (const r of this.relays) r.unsubscribe(callId);
    }

    send(ctx: PeerCtx, callId: string, body: Omit<SignalMsg, "msgId" | "callId" | "from" | "ts">) {
        const msg: SignalMsg = { ...body, msgId: newMsgId(), callId, from: this.o.selfId, ts: this.now() };
        const tags = body.type === "ring"
            ? [["t", topicLine(ctx.peerId)], ["c", pairHint(ctx.channelId)]]
            : [["t", topicCall(callId)]];
        const ev = finalizeEvent({
            kind: KIND,
            created_at: Math.floor(this.now() / 1000),
            tags,
            content: seal(this.keyFor(ctx), msg),
        }, this.sk) as NostrEvent;
        for (const r of this.relays) r.publish(ev);
    }

    private keyFor(ctx: PeerCtx) {
        const id = `${ctx.channelId}:${ctx.peerId}`;
        let k = this.keys.get(id);
        if (!k) { k = deriveKey(ctx.channelId, this.o.selfId, ctx.peerId); this.keys.set(id, k); }
        return k;
    }

    private reportStatus() {
        this.o.onStatus(this.relays.filter(r => r.up).length);
    }

    private onEvent(ev: NostrEvent) {
        if (ev.kind !== KIND) return;
        const t = tag(ev, "t");
        const onLine = t === this.lineTopic;
        let ctx: PeerCtx | null = null;
        if (onLine) {
            const hint = tag(ev, "c");
            ctx = hint ? this.o.resolvePair(hint) : null;
        } else {
            for (const room of this.rooms.values()) if (room.topic === t) { ctx = room.ctx; break; }
        }
        if (!ctx) return;

        const msg = open(this.keyFor(ctx), ev.content) as SignalMsg | null;
        if (!msg || typeof msg !== "object" || typeof msg.msgId !== "string") return;
        if (msg.from !== ctx.peerId) return;
        const now = this.now();
        if (Math.abs(now - msg.ts) > MAX_AGE_MS) return;
        if (this.seen.has(msg.msgId)) return;
        this.seen.set(msg.msgId, now);
        for (const [id, at] of this.seen) if (now - at > MAX_AGE_MS * 2) this.seen.delete(id);
        if (onLine && msg.type !== "ring") return;

        this.o.onMessage(msg, ctx);
    }
}
