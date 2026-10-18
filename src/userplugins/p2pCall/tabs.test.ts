/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { getPick, pickTab, setPick, trackSeen } from "./tabs";

test("no tabs while only one call is running", () => {
    assert.equal(pickTab({ discord: 1, p2p: null }), null);
    assert.equal(pickTab({ discord: null, p2p: 1 }), null);
    assert.equal(pickTab({ discord: null, p2p: null }, "p2p"), null);
});

test("the call started last is shown, p2p on a tie", () => {
    assert.equal(pickTab({ discord: 2, p2p: 1 }), "discord");
    assert.equal(pickTab({ discord: 1, p2p: 2 }), "p2p");
    assert.equal(pickTab({ discord: 1, p2p: 1 }), "p2p");
});

test("manual pick wins over start order", () => {
    assert.equal(pickTab({ discord: 2, p2p: 1 }, "p2p"), "p2p");
});

test("trackSeen keeps the first time a call was seen", () => {
    assert.deepEqual(trackSeen("a", false, true, 10), { discord: null, p2p: 10 });
    assert.deepEqual(trackSeen("a", true, true, 20), { discord: 20, p2p: 10 });
    assert.deepEqual(trackSeen("a", true, true, 30), { discord: 20, p2p: 10 });
});

test("a call that ended resets its time and the manual pick", () => {
    trackSeen("b", true, true, 1);
    setPick("b", "discord");
    assert.equal(getPick("b"), "discord");
    trackSeen("b", true, true, 2);
    assert.equal(getPick("b"), "discord");
    assert.deepEqual(trackSeen("b", true, false, 3), { discord: 1, p2p: null });
    assert.equal(getPick("b"), undefined);
    assert.deepEqual(trackSeen("b", true, true, 4), { discord: 1, p2p: 4 });
});
