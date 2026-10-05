/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { HOLD_MS, rms, SpeakingDetector } from "./speaking";

test("rms of silence is 0 and of a constant is its magnitude", () => {
    assert.equal(rms(new Float32Array(128)), 0);
    assert.ok(Math.abs(rms(new Float32Array(128).fill(0.5)) - 0.5) < 1e-6);
    assert.ok(Math.abs(rms(new Float32Array(128).fill(-0.5)) - 0.5) < 1e-6);
});

test("starts silent and turns on at the ON threshold", () => {
    const d = new SpeakingDetector();
    assert.equal(d.speaking, false);
    assert.equal(d.update(0.039, 0), false);
    assert.equal(d.update(0.04, 100), true);
});

test("turns off only after HOLD_MS of quiet", () => {
    const d = new SpeakingDetector();
    d.update(0.1, 0);
    assert.equal(d.update(0.01, 100), true);
    assert.equal(d.update(0.01, 100 + HOLD_MS - 1), true);
    assert.equal(d.update(0.01, 100 + HOLD_MS), false);
});

test("level between thresholds keeps the current state", () => {
    const off = new SpeakingDetector();
    for (let t = 0; t < 1000; t += 100) assert.equal(off.update(0.03, t), false);
    const on = new SpeakingDetector();
    on.update(0.1, 0);
    for (let t = 100; t < 2000; t += 100) assert.equal(on.update(0.03, t), true);
});

test("noise around the thresholds does not flicker", () => {
    const d = new SpeakingDetector();
    d.update(0.05, 0);
    const levels = [0.019, 0.03, 0.019, 0.035, 0.018, 0.025];
    levels.forEach((l, i) => assert.equal(d.update(l, 100 + i * 100), true));
});

test("a loud sample resets the quiet timer", () => {
    const d = new SpeakingDetector();
    d.update(0.1, 0);
    d.update(0.01, 100);
    d.update(0.1, 300);
    assert.equal(d.update(0.01, 400), true);
    assert.equal(d.update(0.01, 400 + HOLD_MS - 1), true);
    assert.equal(d.update(0.01, 400 + HOLD_MS), false);
});

test("long silence stays silent", () => {
    const d = new SpeakingDetector();
    for (let t = 0; t < 5000; t += 100) assert.equal(d.update(0, t), false);
});
