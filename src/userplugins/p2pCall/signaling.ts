/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";

import { pairHintOf, utcDay } from "./contacts";
import { newMsgId, open, seal, topicCall, topicLine } from "./crypto";
import type { PakeMsg } from "./pairing";
import { NostrEvent, RelayConn, WsFactory } from "./relay";

export const KIND = 25050;
export const MAX_AGE_MS = 30_000;

export type SignalType = "ring" | "accept" | "decline" | "offer" | "answer" | "ice" | "bye" | "tun" | "pairok";
export interface SignalMsg {
    type: SignalType; msgId: string; callId: string; from: string; ts: number;
    channelId?: string; video?: boolean; sdp?: string; candidate?: RTCIceCandidateInit | null; reason?: string;
    /** tun: адрес туннеля этой стороны (specs/001-udp-tunnel-upnp/contracts/tunnel.md §1) */
    addr?: string | null; token?: string; upnp?: string; upnpCode?: number | null;
}
export interface PeerCtx { channelId: string; peerId: string; }
/** Ключ пары с одним доверенным устройством контакта (specs/003-identity-keys R3, R7) */
export interface PairKey { userId: string; deviceId: string; channelId: string; key: Uint8Array; mutual: boolean; }
export interface SignalingOptions {
    selfId: string;
    relays: string[];
    ws: WsFactory;
    onMessage(msg: SignalMsg, ctx: PeerCtx): void;
    onStatus(upCount: number): void;
    /** Сообщения обмена ключами — открытым текстом, разбирает main */
    onPake?(msg: PakeMsg): void;
    /** Пришло сообщение на ключе пары, который ещё не взаимный: значит, у собеседника он тоже есть */
    onMutual?(key: PairKey): void;
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
    private pairKeys: PairKey[] = [];
    private hintCache: { day: number; map: Map<string, PairKey>; } | null = null;
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

    /** Только доверенные устройства: pending-ключу (новое устройство или подмена) не пишем и не верим */
    setPairKeys(keys: PairKey[]) {
        this.pairKeys = keys;
        this.hintCache = null;
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

    /** Есть ли с кем говорить: без ключа пары сигналинг не шлётся вовсе */
    hasKey(userId: string) {
        return this.pairKeys.some(k => k.userId === userId);
    }

    /**
     * По событию на каждое доверенное устройство контакта — ключом пары и с подсказкой от него. Прежней схемы
     * (ключ из ID канала) нет: она публиковала хэш ID канала — пароля обмена ключами (вариант B, 2026-10-18).
     * Без ключа пары — ничего: звонок сначала обменивается ключами (controller.dial).
     */
    send(ctx: PeerCtx, callId: string, body: Omit<SignalMsg, "msgId" | "callId" | "from" | "ts">) {
        const msg: SignalMsg = { ...body, msgId: newMsgId(), callId, from: this.o.selfId, ts: this.now() };
        const own = this.pairKeys.filter(k => k.userId === ctx.peerId);
        const day = utcDay(this.now());
        for (const k of own) {
            const tags = body.type === "ring" ? [["t", topicLine(ctx.peerId)], ["c", pairHintOf(k.key, day)]] : [["t", topicCall(callId)]];
            this.publish(tags, seal(k.key, msg));
        }
    }

    /** Обмен ключами: в линию собеседника, открытым текстом — в сообщениях CPace прятать нечего */
    sendPake(peerId: string, msg: PakeMsg) {
        this.publish([["t", topicLine(peerId)], ["k", "pake"]], JSON.stringify(msg));
    }

    /** Ответчик завершил обмен: даём инициатору знать, что ключ пары взаимный */
    sendPairOk(peerId: string) {
        const day = utcDay(this.now());
        for (const k of this.pairKeys.filter(x => x.userId === peerId)) {
            const msg: SignalMsg = { type: "pairok", msgId: newMsgId(), callId: "", from: this.o.selfId, ts: this.now() };
            this.publish([["t", topicLine(peerId)], ["c", pairHintOf(k.key, day)]], seal(k.key, msg));
        }
    }

    private publish(tags: string[][], content: string) {
        const ev = finalizeEvent({ kind: KIND, created_at: Math.floor(this.now() / 1000), tags, content }, this.sk) as NostrEvent;
        for (const r of this.relays) r.publish(ev);
    }

    /** Подсказки на вчера, сегодня и завтра — звонок около полуночи UTC и часы, спешащие на секунды */
    private hints() {
        const day = utcDay(this.now());
        if (this.hintCache?.day !== day) {
            const map = new Map<string, PairKey>();
            for (const k of this.pairKeys) for (const d of [day - 1, day, day + 1]) map.set(pairHintOf(k.key, d), k);
            this.hintCache = { day, map };
        }
        return this.hintCache.map;
    }

    private reportStatus() {
        this.o.onStatus(this.relays.filter(r => r.up).length);
    }

    private onEvent(ev: NostrEvent) {
        if (ev.kind !== KIND) return;
        const t = tag(ev, "t");
        const onLine = t === this.lineTopic;
        if (onLine && tag(ev, "k") === "pake") { this.onPakeEvent(ev); return; }

        let ctx: PeerCtx | null = null;
        let candidates: PairKey[] = [];
        if (onLine) {
            const hint = tag(ev, "c");
            const k = hint ? this.hints().get(hint) : undefined;
            if (k) {
                ctx = { peerId: k.userId, channelId: k.channelId };
                candidates = [k];
            }
        } else {
            for (const room of this.rooms.values()) if (room.topic === t) { ctx = room.ctx; break; }
            const peerId = ctx?.peerId;
            candidates = this.pairKeys.filter(k => k.userId === peerId);
        }
        if (!ctx) return;

        let msg: SignalMsg | null = null;
        let used: PairKey | null = null;
        for (const k of candidates) {
            msg = open(k.key, ev.content) as SignalMsg | null;
            if (msg) { used = k; break; }
        }
        if (!msg || typeof msg !== "object" || typeof msg.msgId !== "string") return;
        if (msg.from !== ctx.peerId) return;
        const now = this.now();
        if (Math.abs(now - msg.ts) > MAX_AGE_MS) return;
        if (this.seen.has(msg.msgId)) return;
        this.seen.set(msg.msgId, now);
        for (const [id, at] of this.seen) if (now - at > MAX_AGE_MS * 2) this.seen.delete(id);
        if (used && !used.mutual) this.o.onMutual?.(used);
        if (msg.type === "pairok" || (onLine && msg.type !== "ring")) return;

        this.o.onMessage(msg, ctx);
    }

    private onPakeEvent(ev: NostrEvent) {
        if (this.seen.has(ev.id)) return;
        this.seen.set(ev.id, this.now());
        let msg: PakeMsg;
        try { msg = JSON.parse(ev.content); } catch { return; }
        if (msg && typeof msg === "object") this.o.onPake?.(msg);
    }
}
