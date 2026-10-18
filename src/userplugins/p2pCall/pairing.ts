/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Обмен постоянными ключами по CPace, где пароль — ID общего ЛС-канала (specs/003-identity-keys R5, R6).
//   A → B  pake1 { sid, Y }                    — случайная точка, пароль по ней не проверить
//   B → A  pake2 { sid, Y, box(B: pub, mac) }  — box шифруется ключом из ISK
//   A → B  pake3 { sid, box(A: pub, mac) }
// Контакт добавляется только после проверки MAC собеседника: он доказывает знание ID канала.
// Без Electron: личность и книга контактов приходят снаружи.

import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, concatBytes, hexToBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils";

import { AddResult, ContactBook, Identity } from "./contacts";
import { finish, lvCat, start, transcriptIr } from "./cpace";
import { open, seal } from "./crypto";

export type PakeMsg =
    | { type: "pake1"; sid: string; Y: string; from: string; dev: string; ts: number; }
    | { type: "pake2"; sid: string; Y: string; from: string; dev: string; ts: number; box: string; }
    | { type: "pake3"; sid: string; from: string; ts: number; box: string; };

/** Что знает о собеседнике рендерер: ЛС с ним (без ЛС обмена нет — это и есть защита) */
export interface PeerInfo { channelId: string; name?: string; avatar?: string | null; }
export interface HandleResult { send: PakeMsg[]; added: { userId: string; result: AddResult; } | null; }

const MAX_AGE_MS = 30_000;
const SESSION_MS = 30_000;
const RESTART_MS = 10 * 60_000;
/** Повтор по звонку — не чаще, чтобы двойной клик не плодил обмены */
const FORCE_RESTART_MS = 15_000;
const PER_PEER_PER_MIN = 5;
const TOTAL_PER_MIN = 30;
const COOLDOWN_MS = 60_000;

interface Session {
    role: "init" | "resp";
    peerId: string;
    peer: PeerInfo;
    sid: Uint8Array;
    y: bigint;
    Y: Uint8Array;
    startedAt: number;
    /** Ответчик после pake2 ждёт pake3 */
    keys?: { box: Uint8Array; mac: Uint8Array; transcript: Uint8Array; peerDev: string; };
}

const ci = (initiator: string, responder: string) => lvCat(utf8ToBytes("p2pcall-pair"), utf8ToBytes(initiator), utf8ToBytes(responder));
const ad = (userId: string, dev: string) => utf8ToBytes(`${userId}:${dev}`);
const isHex = (s: unknown, bytes: number): s is string => typeof s === "string" && s.length === bytes * 2 && /^[0-9a-f]+$/.test(s);

function sessionKeys(isk: Uint8Array, transcript: Uint8Array, peerDev: string) {
    return {
        box: hkdf(sha256, isk, undefined, "p2pcall-v2 box", 32),
        mac: hkdf(sha256, isk, undefined, "p2pcall-v2 mac", 32),
        transcript,
        peerDev,
    };
}

const macOf = (k: Uint8Array, role: string, transcript: Uint8Array, pub: string) =>
    bytesToHex(hmac(sha256, k, concatBytes(utf8ToBytes(role), transcript, utf8ToBytes(pub))));

export class Pairing {
    private sessions = new Map<string, Session>();
    private lastStart = new Map<string, number>();
    private hits = new Map<string, number[]>();
    private allHits: number[] = [];
    private cooldown = new Map<string, number>();

    constructor(private selfId: string, private id: Identity, private book: ContactBook, private now: () => number = Date.now) { }

    /**
     * null — уже есть взаимный доверенный ключ или недавно пробовали. Ключ без взаимности (собеседник мог не
     * получить pake3) — повод повторить обмен: так он получит наш ключ.
     */
    start(peerId: string, peer: PeerInfo, force = false): PakeMsg | null {
        const now = this.now();
        this.prune(now);
        if (this.book.get(peerId)?.devices.some(d => d.state === "trusted" && d.mutual)) return null;
        if (now - (this.lastStart.get(peerId) ?? -Infinity) < (force ? FORCE_RESTART_MS : RESTART_MS)) return null;
        this.lastStart.set(peerId, now);
        const sid = randomBytes(16);
        const { y, Y } = start(utf8ToBytes(peer.channelId), ci(this.selfId, peerId), sid);
        this.sessions.set(bytesToHex(sid), { role: "init", peerId, peer, sid, y, Y, startedAt: now });
        return { type: "pake1", sid: bytesToHex(sid), Y: bytesToHex(Y), from: this.selfId, dev: this.id.deviceId, ts: now };
    }

    /** peer — ЛС с отправителем из Discord-сторов; null — ЛС нет, сообщение игнорируется */
    handle(msg: PakeMsg, peer: PeerInfo | null): HandleResult {
        const none: HandleResult = { send: [], added: null };
        const now = this.now();
        this.prune(now);
        if (!peer || typeof msg?.from !== "string" || msg.from === this.selfId || !isHex(msg.sid, 16) || typeof msg.ts !== "number" || !(Math.abs(now - msg.ts) <= MAX_AGE_MS)) return none;
        try {
            if (msg.type === "pake1") return this.onPake1(msg, peer, now);
            if (msg.type === "pake2") return this.onPake2(msg);
            if (msg.type === "pake3") return this.onPake3(msg);
        } catch { }
        return none;
    }

    private onPake1(msg: Extract<PakeMsg, { type: "pake1"; }>, peer: PeerInfo, now: number): HandleResult {
        // чужой pake1 с тем же sid не должен затереть идущий обмен
        if (!isHex(msg.Y, 32) || typeof msg.dev !== "string" || this.sessions.has(msg.sid) || !this.allow(msg.from, now)) return { send: [], added: null };
        const sid = hexToBytes(msg.sid);
        const Ya = hexToBytes(msg.Y);
        const { y, Y } = start(utf8ToBytes(peer.channelId), ci(msg.from, this.selfId), sid);
        const transcript = transcriptIr(Ya, ad(msg.from, msg.dev), Y, ad(this.selfId, this.id.deviceId));
        const isk = finish(y, Ya, sid, transcript);
        if (!isk) return { send: [], added: null };
        const keys = sessionKeys(isk, transcript, msg.dev);
        this.sessions.set(msg.sid, { role: "resp", peerId: msg.from, peer, sid, y, Y, startedAt: now, keys });
        const pub = bytesToHex(this.id.publicKey);
        const box = seal(keys.box, { pub, mac: macOf(keys.mac, "resp", transcript, pub) });
        return { send: [{ type: "pake2", sid: msg.sid, Y: bytesToHex(Y), from: this.selfId, dev: this.id.deviceId, ts: now, box }], added: null };
    }

    private onPake2(msg: Extract<PakeMsg, { type: "pake2"; }>): HandleResult {
        const s = this.sessions.get(msg.sid);
        if (!s || s.role !== "init" || s.peerId !== msg.from || !isHex(msg.Y, 32) || typeof msg.dev !== "string") return { send: [], added: null };
        // сессию удаляем только после проверки: иначе наблюдатель релея обрывает обмен подделкой
        const Yb = hexToBytes(msg.Y);
        const transcript = transcriptIr(s.Y, ad(this.selfId, this.id.deviceId), Yb, ad(msg.from, msg.dev));
        const isk = finish(s.y, Yb, s.sid, transcript);
        if (!isk) return { send: [], added: null };
        const keys = sessionKeys(isk, transcript, msg.dev);
        const theirs = open(keys.box, msg.box) as { pub?: unknown; mac?: unknown; } | null;
        if (!theirs || !this.validPub(theirs.pub) || theirs.mac !== macOf(keys.mac, "resp", transcript, theirs.pub)) return { send: [], added: null };
        this.sessions.delete(msg.sid);
        const result = this.book.addDevice(msg.from, { deviceId: msg.dev, publicKey: theirs.pub, ...s.peer });
        const pub = bytesToHex(this.id.publicKey);
        const box = seal(keys.box, { pub, mac: macOf(keys.mac, "init", transcript, pub) });
        return { send: [{ type: "pake3", sid: msg.sid, from: this.selfId, ts: this.now(), box }], added: { userId: msg.from, result } };
    }

    private onPake3(msg: Extract<PakeMsg, { type: "pake3"; }>): HandleResult {
        const s = this.sessions.get(msg.sid);
        if (!s?.keys || s.role !== "resp" || s.peerId !== msg.from) return { send: [], added: null };
        const { keys } = s;
        const theirs = open(keys.box, msg.box) as { pub?: unknown; mac?: unknown; } | null;
        if (!theirs || !this.validPub(theirs.pub) || theirs.mac !== macOf(keys.mac, "init", keys.transcript, theirs.pub)) return { send: [], added: null };
        this.sessions.delete(msg.sid);
        // pake3 доказывает, что у инициатора наш ключ уже есть — пара взаимна сразу
        const result = this.book.addDevice(msg.from, { deviceId: keys.peerDev, publicKey: theirs.pub, ...s.peer, mutual: true });
        return { send: [], added: { userId: msg.from, result } };
    }

    /** Ответ на pake1 — живая попытка угадать ID канала, поэтому их мало (research R6) */
    private allow(from: string, now: number) {
        if ((this.cooldown.get(from) ?? 0) > now) return false;
        const recent = (this.hits.get(from) ?? []).filter(t => now - t < 60_000);
        this.allHits = this.allHits.filter(t => now - t < 60_000);
        if (recent.length >= PER_PEER_PER_MIN || this.allHits.length >= TOTAL_PER_MIN) return false;
        recent.push(now);
        this.hits.set(from, recent);
        this.allHits.push(now);
        return true;
    }

    /** Ключ, с которым X25519 не даёт общего секрета (нулевой, малого порядка), сломал бы все ключи пар */
    private validPub(pub: unknown): pub is string {
        if (!isHex(pub, 32)) return false;
        try {
            x25519.getSharedSecret(this.id.privateKey, hexToBytes(pub));
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Ответчик, не дождавшийся pake3, — это и есть неудачная догадка: угадывающий проверяет её по pake2 у себя
     * и pake3 не шлёт. Пауза для этого отправителя
     */
    private prune(now: number) {
        for (const [k, s] of this.sessions) {
            if (now - s.startedAt <= SESSION_MS) continue;
            this.sessions.delete(k);
            // пауза — от истечения сессии, а не от момента, когда мы это заметили
            if (s.role === "resp") this.cooldown.set(s.peerId, Math.max(this.cooldown.get(s.peerId) ?? 0, s.startedAt + SESSION_MS + COOLDOWN_MS));
        }
    }
}
