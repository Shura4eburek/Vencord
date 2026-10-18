/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

import { pairHintOf, utcDay } from "./contacts";
import { topicLine } from "./crypto";
import { WsLike } from "./relay";
import { PairKey, PeerCtx, Signaling, SignalMsg } from "./signaling";

const A = "600000000000000001";
const B = "500000000000000002";
const CH = "700000000000000003";

/** In-memory "relay": все сокеты одного url видят публикации друг друга по REQ-фильтрам. */
function hub() {
    const sockets: { ws: WsLike & { deliver(d: string): void; }; subs: Map<string, any>; url: string; }[] = [];
    const factory = (url: string) => {
        const entry: any = { subs: new Map(), url };
        const ws: any = {
            readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null,
            deliver(d: string) { ws.onmessage?.({ data: d }); },
            send(d: string) {
                const m = JSON.parse(d);
                if (m[0] === "REQ") entry.subs.set(m[1], m[2]);
                if (m[0] === "CLOSE") entry.subs.delete(m[1]);
                if (m[0] === "EVENT") {
                    for (const s of sockets) {
                        if (s.url !== url) continue;
                        for (const [id, f] of s.subs) {
                            const t = m[1].tags.find((x: string[]) => x[0] === "t")?.[1];
                            if (f.kinds.includes(m[1].kind) && f["#t"].includes(t)) s.ws.deliver(JSON.stringify(["EVENT", id, m[1]]));
                        }
                    }
                }
            },
            close() { ws.onclose?.(); },
        };
        entry.ws = ws;
        sockets.push(entry);
        queueMicrotask(() => { ws.readyState = 1; ws.onopen?.(); });
        return ws;
    };
    return factory;
}

function client(selfId: string, peerId: string, ws: ReturnType<typeof hub>, relays = ["wss://r1"], now = () => Date.now()) {
    const got: { msg: SignalMsg; ctx: PeerCtx; }[] = [];
    const ups: number[] = [];
    const sig = new Signaling({
        selfId, relays, ws, now,
        onMessage: (msg, ctx) => got.push({ msg, ctx }),
        onStatus: n => ups.push(n),
    });
    // общий ключ пары с собеседником — без него сигналинга нет
    sig.setPairKeys([{ userId: peerId, deviceId: "d".repeat(32), channelId: CH, key: new Uint8Array(32).fill(9), mutual: true }]);
    return { sig, got, ups };
}

/** Хэш ID канала, который публиковала прежняя схема: его не должно быть на релеях */
const legacyHint = (channelId: string) => bytesToHex(sha256(utf8ToBytes(`p2pcall-v1:pair:${channelId}`)));

const tick = () => new Promise(r => setTimeout(r, 0));

test("ring reaches the callee line with resolved ctx", async () => {
    const ws = hub();
    const a = client(A, B, ws), b = client(B, A, ws);
    a.sig.start(); b.sig.start();
    await tick();
    a.sig.send({ channelId: CH, peerId: B }, "c1", { type: "ring", video: true, channelId: CH });
    await tick();
    assert.equal(b.got.length, 1);
    assert.equal(b.got[0].msg.type, "ring");
    assert.equal(b.got[0].msg.from, A);
    assert.equal(b.got[0].msg.video, true);
    assert.deepEqual(b.got[0].ctx, { channelId: CH, peerId: A });
    assert.equal(a.got.length, 0);
});

test("room messages flow after joinCall, stop after leaveCall", async () => {
    const ws = hub();
    const a = client(A, B, ws), b = client(B, A, ws);
    a.sig.start(); b.sig.start();
    await tick();
    const ctxA = { channelId: CH, peerId: B }, ctxB = { channelId: CH, peerId: A };
    a.sig.joinCall("c1", ctxA); b.sig.joinCall("c1", ctxB);
    await tick();
    b.sig.send(ctxB, "c1", { type: "accept" });
    await tick();
    assert.deepEqual(a.got.map(g => g.msg.type), ["accept"]);
    a.sig.leaveCall("c1");
    b.sig.send(ctxB, "c1", { type: "bye", reason: "hangup" });
    await tick();
    assert.equal(a.got.length, 1);
});

test("tun travels through the call room with its tunnel fields", async () => {
    const ws = hub();
    const a = client(A, B, ws), b = client(B, A, ws);
    a.sig.start(); b.sig.start();
    await tick();
    const ctxA = { channelId: CH, peerId: B }, ctxB = { channelId: CH, peerId: A };
    a.sig.joinCall("c1", ctxA); b.sig.joinCall("c1", ctxB);
    await tick();
    b.sig.send(ctxB, "c1", { type: "tun", addr: "178.158.220.104:40123", token: "0102030405060708", upnp: "ok" });
    await tick();
    const m = a.got[0].msg;
    assert.deepEqual([m.type, m.addr, m.token, m.upnp], ["tun", "178.158.220.104:40123", "0102030405060708", "ok"]);
});

test("duplicate delivery via several relays is handled once", async () => {
    const ws = hub();
    const relays = ["wss://r1", "wss://r2", "wss://r3"];
    const a = client(A, B, ws, relays), b = client(B, A, ws, relays);
    a.sig.start(); b.sig.start();
    await tick();
    a.sig.send({ channelId: CH, peerId: B }, "c1", { type: "ring", video: false, channelId: CH });
    await tick();
    assert.equal(b.got.length, 1);
});

test("onStatus reports number of live relays", async () => {
    const ws = hub();
    const a = client(A, B, ws, ["wss://r1", "wss://r2"]);
    a.sig.start();
    await tick();
    assert.equal(a.ups.at(-1), 2);
    a.sig.stop();
    assert.equal(a.ups.at(-1), 0);
});

test("stale messages (>30s) are dropped", async () => {
    const ws = hub();
    const t = 1_000_000;
    const a = client(A, B, ws, ["wss://r1"], () => t - 31_000);
    const b = client(B, A, ws, ["wss://r1"], () => t);
    a.sig.start(); b.sig.start();
    await tick();
    a.sig.send({ channelId: CH, peerId: B }, "c1", { type: "ring", video: false, channelId: CH });
    await tick();
    assert.equal(b.got.length, 0);
});

test("ring from someone who is not the DM peer is dropped", async () => {
    const ws = hub();
    const mallory = client("111111111111111111", B, ws);
    const b = client(B, A, ws);
    mallory.sig.start(); b.sig.start();
    await tick();
    // mallory знает канал, но подписывается своим ID — from не совпадёт с A
    mallory.sig.send({ channelId: CH, peerId: B }, "c1", { type: "ring", video: false, channelId: CH });
    await tick();
    assert.equal(b.got.length, 0);
});

test("a ring under a key the callee does not have is ignored", async () => {
    const ws = hub();
    const a = client(A, B, ws), b = client(B, A, ws);
    a.sig.setPairKeys([{ userId: B, deviceId: "d".repeat(32), channelId: CH, key: new Uint8Array(32).fill(1), mutual: true }]);
    a.sig.start(); b.sig.start();
    await tick();
    a.sig.send({ channelId: CH, peerId: B }, "c1", { type: "ring", video: false, channelId: CH });
    await tick();
    assert.equal(b.got.length, 0);
});

// ── ключи пар (specs/003-identity-keys) ──

const key = (fill: number) => new Uint8Array(32).fill(fill);
const pk = (userId: string, fill: number, mutual = true): PairKey => ({ userId, deviceId: "d".repeat(32), channelId: CH, key: key(fill), mutual });

/** Сырой подписчик хаба: что реально уходит на релей в линию получателя */
async function spy(ws: ReturnType<typeof hub>, topic: string) {
    const events: any[] = [];
    const s: any = ws("wss://r1");
    s.onmessage = (e: { data: string; }) => { const m = JSON.parse(e.data); if (m[0] === "EVENT") events.push(m[2]); };
    await tick();
    s.send(JSON.stringify(["REQ", "spy", { kinds: [25050], "#t": [topic] }]));
    return events;
}

function keyed(selfId: string, peerId: string, ws: ReturnType<typeof hub>, keys: PairKey[]) {
    const c = client(selfId, peerId, ws);
    const extra = { pake: [] as any[], mutual: [] as PairKey[] };
    (c.sig as any).o.onPake = (m: any) => extra.pake.push(m);
    (c.sig as any).o.onMutual = (k: PairKey) => extra.mutual.push(k);
    c.sig.setPairKeys(keys);
    return { ...c, ...extra };
}

test("ring to a contact uses the pair key and a hint unrelated to the channel id", async () => {
    const ws = hub();
    const a = keyed(A, B, ws, [pk(B, 7)]), b = keyed(B, A, ws, [pk(A, 7)]);
    a.sig.start(); b.sig.start();
    await tick();
    const seen = await spy(ws, topicLine(B));
    a.sig.send({ channelId: CH, peerId: B }, "c1", { type: "ring", video: false, channelId: CH });
    await tick();
    assert.equal(b.got.length, 1);
    assert.deepEqual(b.got[0].ctx, { channelId: CH, peerId: A });
    const c = seen[0].tags.find((t: string[]) => t[0] === "c")[1];
    assert.notEqual(c, legacyHint(CH), "no brute-forceable channel hash on the relay");
    assert.equal(c, pairHintOf(key(7), utcDay(Date.now())));
});

test("a hint from yesterday is still accepted", async () => {
    const ws = hub();
    const now = Date.UTC(2026, 9, 18, 0, 0, 10);
    const a = keyed(A, B, ws, [pk(B, 7)]), b = keyed(B, A, ws, [pk(A, 7)]);
    (a.sig as any).now = () => now - 20_000;
    (b.sig as any).now = () => now;
    a.sig.start(); b.sig.start();
    await tick();
    a.sig.send({ channelId: CH, peerId: B }, "c1", { type: "ring", video: false, channelId: CH });
    await tick();
    assert.equal(b.got.length, 1);
});

test("pake messages go plaintext on the peer line without a c tag", async () => {
    const ws = hub();
    const a = keyed(A, B, ws, []), b = keyed(B, A, ws, []);
    a.sig.start(); b.sig.start();
    await tick();
    const seen = await spy(ws, topicLine(B));
    const m = { type: "pake1", sid: "ab".repeat(16), Y: "cd".repeat(32), from: A, dev: "e".repeat(32), ts: Date.now() } as const;
    a.sig.sendPake(B, m);
    await tick();
    assert.deepEqual(b.pake, [m]);
    assert.equal(seen[0].tags.some((t: string[]) => t[0] === "c"), false);
    assert.equal(b.got.length, 0);
});

test("without a pair key nothing is sent and nothing is accepted", async () => {
    const ws = hub();
    const a = keyed(A, B, ws, []), b = keyed(B, A, ws, []);
    a.sig.start(); b.sig.start();
    await tick();
    const seen = await spy(ws, topicLine(B));
    assert.equal(a.sig.hasKey(B), false);
    a.sig.send({ channelId: CH, peerId: B }, "c1", { type: "ring", video: false, channelId: CH });
    await tick();
    assert.equal(seen.length, 0);
    assert.equal(b.got.length, 0);
});

test("a non-mutual key sends only the keyed copy; pairok marks it mutual", async () => {
    const ws = hub();
    const a = keyed(A, B, ws, [pk(B, 7, false)]); // инициатор: ключ есть, но не знает, есть ли он у B
    const b = keyed(B, A, ws, [pk(A, 7)]);
    a.sig.start(); b.sig.start();
    await tick();
    a.sig.send({ channelId: CH, peerId: B }, "c1", { type: "ring", video: false, channelId: CH });
    await tick();
    assert.equal(b.got.length, 1, "B (mutual) takes the pair-key copy");
    b.sig.sendPairOk(A);
    await tick();
    assert.equal(a.mutual.length, 1);
    assert.equal(a.got.length, 0, "pairok is not a call message");
});
