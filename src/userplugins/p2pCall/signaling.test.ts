import assert from "node:assert/strict";
import { test } from "node:test";

import { pairHint } from "./crypto";
import { WsLike } from "./relay";
import { PeerCtx, SignalMsg, Signaling } from "./signaling";

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
        resolvePair: h => h === pairHint(CH) ? { channelId: CH, peerId } : null,
        onMessage: (msg, ctx) => got.push({ msg, ctx }),
        onStatus: n => ups.push(n),
    });
    return { sig, got, ups };
}

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

test("unknown pair hint is ignored", async () => {
    const ws = hub();
    const a = client(A, B, ws), b = client(B, A, ws);
    a.sig.start(); b.sig.start();
    await tick();
    a.sig.send({ channelId: "999", peerId: B }, "c1", { type: "ring", video: false, channelId: "999" });
    await tick();
    assert.equal(b.got.length, 0);
});
