/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { INITIAL_AUDIO, toggleDeafenState, toggleMicState } from "./localAudio";

test("initial: mic on, not deafened", () => {
    assert.deepEqual(INITIAL_AUDIO, { mic: true, deafened: false, micBeforeDeafen: true });
});

test("mic toggles while not deafened", () => {
    const off = toggleMicState(INITIAL_AUDIO);
    assert.equal(off.mic, false);
    assert.equal(toggleMicState(off).mic, true);
});

test("deafen turns the mic off and remembers it", () => {
    const d = toggleDeafenState(INITIAL_AUDIO);
    assert.deepEqual(d, { mic: false, deafened: true, micBeforeDeafen: true });
});

test("undeafen restores the remembered mic state", () => {
    assert.equal(toggleDeafenState(toggleDeafenState(INITIAL_AUDIO)).mic, true);
    const mutedFirst = toggleMicState(INITIAL_AUDIO);
    const back = toggleDeafenState(toggleDeafenState(mutedFirst));
    assert.equal(back.mic, false);
    assert.equal(back.deafened, false);
});

test("turning the mic on while deafened also undeafens (like Discord)", () => {
    const r = toggleMicState(toggleDeafenState(INITIAL_AUDIO));
    assert.deepEqual(r, { mic: true, deafened: false, micBeforeDeafen: true });
});
