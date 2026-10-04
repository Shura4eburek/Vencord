import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveKey, newCallId, open, pairHint, seal, topicCall, topicLine } from "./crypto";

const A = "600000000000000001";
const B = "500000000000000002";
const CH = "700000000000000003";

test("topics are 64-char hex and differ by kind", () => {
    assert.match(topicLine(A), /^[0-9a-f]{64}$/);
    assert.notEqual(topicLine(A), topicCall(A));
    assert.notEqual(topicLine(A), pairHint(A));
});

test("both sides derive the same key regardless of argument order", () => {
    assert.deepEqual(deriveKey(CH, A, B), deriveKey(CH, B, A));
    assert.equal(deriveKey(CH, A, B).length, 32);
});

test("ids above 2^53 are ordered numerically, not lexically", () => {
    // лексически "99..." > "100...", численно наоборот
    const small = "99999999999999999";
    const big = "100000000000000000";
    assert.deepEqual(deriveKey(CH, small, big), deriveKey(CH, big, small));
});

test("seal/open round-trip", () => {
    const key = deriveKey(CH, A, B);
    const msg = { type: "ring", n: 1 };
    assert.deepEqual(open(key, seal(key, msg)), msg);
});

test("open with a foreign key returns null", () => {
    const sealed = seal(deriveKey(CH, A, B), { x: 1 });
    assert.equal(open(deriveKey("1", A, B), sealed), null);
});

test("open on garbage returns null", () => {
    assert.equal(open(deriveKey(CH, A, B), "not base64 at all!"), null);
});

test("newCallId is 32 hex chars and random", () => {
    assert.match(newCallId(), /^[0-9a-f]{32}$/);
    assert.notEqual(newCallId(), newCallId());
});
