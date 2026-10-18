/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { DIAL_GAP_MS, DIAL_MAX_PER_WINDOW, DIAL_WINDOW_MS, dialWait } from "./dialLimit";

test("first dial is never delayed", () => {
    assert.equal(dialWait([], 1000), 0);
});

test("redial right after the previous one waits for the gap", () => {
    assert.equal(dialWait([10_000], 11_000), DIAL_GAP_MS - 1000);
    assert.equal(dialWait([10_000], 10_000 + DIAL_GAP_MS), 0);
});

test("too many dials in a minute wait until the oldest leaves the window", () => {
    const history = Array.from({ length: DIAL_MAX_PER_WINDOW }, (_, i) => i * 5000);
    const now = history[history.length - 1] + DIAL_GAP_MS;
    assert.equal(dialWait(history, now), history[0] + DIAL_WINDOW_MS - now);
    assert.equal(dialWait(history, history[0] + DIAL_WINDOW_MS), 0);
});

test("old dials outside the window do not count", () => {
    assert.equal(dialWait([0, 1, 2, 3, 4, 5, 6], DIAL_WINDOW_MS + 10), 0);
});
