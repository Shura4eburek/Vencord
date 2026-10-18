/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { BACKOFF_MS, BAN_PAUSE_MS, DEFAULT_RELAY_LIST, LIMIT_PAUSE_MS, limitPause, NostrEvent, RelayConn, relayCspSource, upgradeRelays, WsLike } from "./relay";

class FakeWs implements WsLike {
    readyState = 0;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string; }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    send(d: string) { this.sent.push(d); }
    close() { this.readyState = 3; this.onclose?.(); }
    open() { this.readyState = 1; this.onopen?.(); }
    drop() { this.readyState = 3; this.onclose?.(); }
}

function setup() {
    const sockets: FakeWs[] = [];
    const timers: { fn: () => void; ms: number; }[] = [];
    const events: NostrEvent[] = [];
    const status: boolean[] = [];
    const conn = new RelayConn(
        "wss://r",
        () => { const s = new FakeWs(); sockets.push(s); return s; },
        e => events.push(e),
        up => status.push(up),
        (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        () => { },
    );
    return { conn, sockets, timers, events, status };
}

const ev = { id: "1", pubkey: "p", created_at: 1, kind: 25050, tags: [["t", "x"]], content: "c", sig: "s" };

test("sends REQ for subscriptions once open", () => {
    const { conn, sockets } = setup();
    conn.subscribe("s1", { kinds: [25050], "#t": ["x"] });
    conn.start();
    sockets[0].open();
    assert.deepEqual(sockets[0].sent.map(s => JSON.parse(s)), [["REQ", "s1", { kinds: [25050], "#t": ["x"] }]]);
});

test("dispatches EVENT frames and ignores garbage", () => {
    const { conn, sockets, events } = setup();
    conn.start();
    sockets[0].open();
    sockets[0].onmessage!({ data: JSON.stringify(["EVENT", "s1", ev]) });
    sockets[0].onmessage!({ data: "{broken" });
    sockets[0].onmessage!({ data: JSON.stringify(["NOTICE", "hi"]) });
    assert.deepEqual(events, [ev]);
});

test("publish while down is dropped, while up is sent", () => {
    const { conn, sockets } = setup();
    conn.start();
    conn.publish(ev);
    sockets[0].open();
    conn.publish(ev);
    assert.deepEqual(sockets[0].sent.map(s => JSON.parse(s)), [["EVENT", ev]]);
});

test("reconnects with backoff and re-subscribes; status toggles", () => {
    const { conn, sockets, timers, status } = setup();
    conn.subscribe("s1", { kinds: [25050], "#t": ["x"] });
    conn.start();
    sockets[0].open();
    sockets[0].drop();
    assert.equal(timers.at(-1)!.ms, BACKOFF_MS[0]);
    timers.at(-1)!.fn();
    sockets[1].drop();
    assert.equal(timers.at(-1)!.ms, BACKOFF_MS[1]);
    timers.at(-1)!.fn();
    sockets[2].open();
    assert.deepEqual(JSON.parse(sockets[2].sent[0]), ["REQ", "s1", { kinds: [25050], "#t": ["x"] }]);
    assert.deepEqual(status, [true, false, true]);
});

test("backoff caps at 30s and resets after a successful open", () => {
    const { conn, sockets, timers } = setup();
    conn.start();
    for (let i = 0; i < 8; i++) { sockets.at(-1)!.drop(); timers.at(-1)!.fn(); }
    assert.equal(timers.at(-1)!.ms, 30000);
    sockets.at(-1)!.open();
    sockets.at(-1)!.drop();
    assert.equal(timers.at(-1)!.ms, 1000);
});

test("unsubscribe sends CLOSE; stop does not reconnect", () => {
    const { conn, sockets, timers } = setup();
    conn.subscribe("s1", { kinds: [25050], "#t": ["x"] });
    conn.start();
    sockets[0].open();
    conn.unsubscribe("s1");
    assert.deepEqual(JSON.parse(sockets[0].sent.at(-1)!), ["CLOSE", "s1"]);
    const before = timers.length;
    conn.stop();
    assert.equal(timers.length, before);
});

test("relayCspSource keeps the wss scheme (scheme-less hosts only allow https)", () => {
    assert.equal(relayCspSource("wss://relay.damus.io"), "wss://relay.damus.io");
    assert.equal(relayCspSource("wss://relay.example.com:7447/path"), "wss://relay.example.com:7447");
    assert.equal(relayCspSource("not a url"), null);
    assert.equal(relayCspSource("https://evil.example"), null);
});

test("OK false with a ban pauses the relay: it is down and publishes nothing", () => {
    let now = 0;
    const sockets: FakeWs[] = [];
    const timers: { fn: () => void; ms: number; }[] = [];
    const status: boolean[] = [];
    const rejects: { reason: string; paused: boolean; }[] = [];
    const conn = new RelayConn("wss://r", () => { const s = new FakeWs(); sockets.push(s); return s; }, () => { }, up => status.push(up),
        (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, () => { }, r => rejects.push(r), () => now);
    conn.start();
    sockets[0].open();
    assert.equal(conn.up, true);
    sockets[0].onmessage!({ data: JSON.stringify(["OK", "id", false, "banned: too many rate-limit violations, try again later"]) });
    assert.equal(conn.up, false);
    assert.deepEqual(status, [true, false]);
    assert.deepEqual(rejects, [{ url: "wss://r", reason: "banned: too many rate-limit violations, try again later", paused: true }]);
    conn.publish(ev);
    assert.equal(sockets[0].sent.length, 0);
    // пауза кончилась — снова живой
    now = BAN_PAUSE_MS;
    timers[timers.length - 1].fn();
    assert.equal(conn.up, true);
    assert.equal(status[status.length - 1], true);
});

test("limitPause: ban is long, rate-limited is short, other rejects do not pause", () => {
    assert.equal(limitPause("banned: too many rate-limit violations"), BAN_PAUSE_MS);
    assert.equal(limitPause("rate-limited: slow down"), LIMIT_PAUSE_MS);
    assert.equal(limitPause("invalid: bad signature"), 0);
    assert.equal(limitPause("duplicate: already have this event"), 0);
});

test("upgradeRelays replaces only the untouched old default list", () => {
    assert.equal(upgradeRelays("wss://relay.damus.io, wss://nos.lol, wss://nostr.mom"), DEFAULT_RELAY_LIST.join(", "));
    assert.equal(upgradeRelays("wss://my.relay"), "wss://my.relay");
});
