/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { randomBytes } from "@noble/hashes/utils";

import { newCallId, open, seal, topicCall, topicLine } from "./crypto";

const A = "600000000000000001";
const key = randomBytes(32);

test("topics are 64-char hex and differ by kind", () => {
    assert.match(topicLine(A), /^[0-9a-f]{64}$/);
    assert.notEqual(topicLine(A), topicCall(A));
});

test("seal/open round-trip", () => {
    const msg = { type: "ring", n: 1 };
    assert.deepEqual(open(key, seal(key, msg)), msg);
});

test("open with a foreign key returns null", () => {
    const sealed = seal(key, { x: 1 });
    assert.equal(open(randomBytes(32), sealed), null);
});

test("open on garbage returns null", () => {
    assert.equal(open(key, "not base64 at all!"), null);
});

test("newCallId is 32 hex chars and random", () => {
    assert.match(newCallId(), /^[0-9a-f]{32}$/);
    assert.notEqual(newCallId(), newCallId());
});
