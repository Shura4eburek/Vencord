import assert from "node:assert/strict";
import { test } from "node:test";

import { CallState, isPolite, reduce } from "./state";

const peer = { callId: "c1", peerId: "500000000000000002", channelId: "700000000000000003" };
const idle: CallState = { phase: "idle" };
const kinds = (r: ReturnType<typeof reduce>) => r.effects.map(e => e.kind);

test("dial: idle → outgoing, rings, joins room, starts ring timer", () => {
    const r = reduce(idle, { type: "dial", video: false, ...peer });
    assert.equal(r.state.phase, "outgoing");
    assert.deepEqual(kinds(r), ["join-room", "send-ring", "start-timer"]);
});

test("ring: idle → incoming with ringtone and ring timer", () => {
    const r = reduce(idle, { type: "ring", video: true, ...peer });
    assert.equal(r.state.phase, "incoming");
    assert.deepEqual(kinds(r), ["join-room", "ringtone", "start-timer"]);
});

test("remote-accept: outgoing → connecting, starts session and ice timer", () => {
    const out = reduce(idle, { type: "dial", video: false, ...peer }).state;
    const r = reduce(out, { type: "remote-accept", callId: "c1" });
    assert.equal(r.state.phase, "connecting");
    assert.deepEqual(kinds(r), ["clear-timers", "start-session", "start-timer"]);
});

test("accept: incoming → connecting, sends accept", () => {
    const inc = reduce(idle, { type: "ring", video: false, ...peer }).state;
    const r = reduce(inc, { type: "accept" });
    assert.equal(r.state.phase, "connecting");
    assert.deepEqual(kinds(r), ["ringtone", "clear-timers", "send", "start-session", "start-timer"]);
});

test("ice-connected: connecting → connected, clears timers", () => {
    const inc = reduce(idle, { type: "ring", video: false, ...peer }).state;
    const conn = reduce(inc, { type: "accept" }).state;
    const r = reduce(conn, { type: "ice-connected" });
    assert.equal(r.state.phase, "connected");
    assert.deepEqual(kinds(r), ["clear-timers"]);
});

test("ring timeout while outgoing → ended no-answer with fallback", () => {
    const out = reduce(idle, { type: "dial", video: false, ...peer }).state;
    const r = reduce(out, { type: "timeout", which: "ring", callId: "c1" });
    assert.deepEqual(r.state, { phase: "ended", reason: "no-answer", peerId: peer.peerId, channelId: peer.channelId });
    assert.ok(kinds(r).includes("offer-fallback"));
    assert.ok(kinds(r).includes("leave-room"));
});

test("ice timeout → ended ice-timeout with fallback and session stop", () => {
    const out = reduce(idle, { type: "dial", video: false, ...peer }).state;
    const conn = reduce(out, { type: "remote-accept", callId: "c1" }).state;
    const r = reduce(conn, { type: "timeout", which: "ice", callId: "c1" });
    assert.equal(r.state.phase, "ended");
    assert.ok(kinds(r).includes("stop-session"));
    assert.ok(kinds(r).includes("offer-fallback"));
});

test("stale ring timer after accept is ignored", () => {
    const out = reduce(idle, { type: "dial", video: false, ...peer }).state;
    const conn = reduce(out, { type: "remote-accept", callId: "c1" }).state;
    const r = reduce(conn, { type: "timeout", which: "ring", callId: "c1" });
    assert.equal(r.state, conn);
    assert.deepEqual(r.effects, []);
});

test("timer from another call is ignored", () => {
    const out = reduce(idle, { type: "dial", video: false, ...peer }).state;
    const r = reduce(out, { type: "timeout", which: "ring", callId: "old" });
    assert.equal(r.state, out);
});

test("ring while busy → decline busy to the new caller, state untouched", () => {
    const out = reduce(idle, { type: "dial", video: false, ...peer }).state;
    const other = { callId: "c2", peerId: "111111111111111111", channelId: "222222222222222222" };
    const r = reduce(out, { type: "ring", video: false, ...other });
    assert.equal(r.state, out);
    assert.deepEqual(r.effects, [
        { kind: "join-room", peer: other },
        { kind: "send", peer: other, msg: { type: "decline", reason: "busy" } },
        { kind: "leave-room", callId: "c2" },
    ]);
});

test("remote-decline busy → ended busy without fallback", () => {
    const out = reduce(idle, { type: "dial", video: false, ...peer }).state;
    const r = reduce(out, { type: "remote-decline", callId: "c1", reason: "busy" });
    assert.equal(r.state.phase, "ended");
    assert.ok(!kinds(r).includes("offer-fallback"));
});

test("hangup while connected sends bye and stops session", () => {
    const out = reduce(idle, { type: "dial", video: false, ...peer }).state;
    const conn = reduce(out, { type: "remote-accept", callId: "c1" }).state;
    const r = reduce(conn, { type: "hangup" });
    assert.deepEqual(r.state, { phase: "ended", reason: "hangup", peerId: peer.peerId, channelId: peer.channelId });
    assert.deepEqual(kinds(r), ["clear-timers", "ringtone", "send", "stop-session", "leave-room"]);
});

test("remote-bye with foreign callId is ignored", () => {
    const out = reduce(idle, { type: "dial", video: false, ...peer }).state;
    const r = reduce(out, { type: "remote-bye", callId: "zzz" });
    assert.equal(r.state, out);
});

test("reset: ended → idle", () => {
    const ended: CallState = { phase: "ended", reason: "hangup", peerId: "1", channelId: "2" };
    assert.deepEqual(reduce(ended, { type: "reset" }).state, { phase: "idle" });
});

test("isPolite compares snowflakes as BigInt", () => {
    assert.equal(isPolite("99999999999999999", "100000000000000000"), true);
    assert.equal(isPolite("100000000000000000", "99999999999999999"), false);
    assert.equal(isPolite("9007199254740993", "9007199254740992"), false);
});
