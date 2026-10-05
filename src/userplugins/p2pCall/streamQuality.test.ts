/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { captureConstraints, DEFAULT_QUALITY, displayMediaConstraints, encoderParams, FPS_OPTIONS, fpsAllowed, heightLabel, hzFromIntervals, needsRecapture, sanitizeQuality, trackConstraints } from "./streamQuality";

test("defaults: source resolution, 60 fps, 20 Mbps, keep fps", () => {
    assert.deepEqual(DEFAULT_QUALITY, { height: 0, fps: 60, maxMbps: 20, prefer: "fps" });
});

test("capture constraints cap height and fps, never upscale width", () => {
    // без minFrameRate Chromium ставит захвату экрана 30 FPS; выше 60 legacy-захват не пускает (OverconstrainedError)
    assert.deepEqual(captureConstraints({ height: 1080, fps: 60, maxMbps: 40, prefer: "fps" }), { maxWidth: 7680, maxHeight: 1080, minFrameRate: 60, maxFrameRate: 60 });
    assert.deepEqual(captureConstraints({ height: 0, fps: 60, maxMbps: 20, prefer: "fps" }), { maxWidth: 7680, maxHeight: 4320, minFrameRate: 60, maxFrameRate: 60 });
    assert.deepEqual(captureConstraints({ height: 720, fps: 30, maxMbps: 10, prefer: "fps" }), { maxWidth: 7680, maxHeight: 720, minFrameRate: 30, maxFrameRate: 30 });
});

test("track constraints for live change", () => {
    assert.deepEqual(trackConstraints({ height: 720, fps: 30, maxMbps: 10, prefer: "fps" }), { height: { max: 720 }, frameRate: { max: 30 } });
    assert.deepEqual(trackConstraints({ height: 0, fps: 60, maxMbps: 80, prefer: "fps" }), { frameRate: { max: 60 } });
});

test("encoder params follow the quality", () => {
    assert.deepEqual(encoderParams({ height: 1440, fps: 60, maxMbps: 40, prefer: "fps" }),
        { maxBitrate: 40_000_000, maxFramerate: 60, degradationPreference: "maintain-framerate", contentHint: "motion" });
    assert.deepEqual(encoderParams({ height: 1440, fps: 30, maxMbps: 10, prefer: "detail" }),
        { maxBitrate: 10_000_000, maxFramerate: 30, degradationPreference: "maintain-resolution", contentHint: "detail" });
});

test("fps above the monitor refresh (+5%) is not allowed", () => {
    assert.equal(fpsAllowed(60, 179), true);
    assert.equal(fpsAllowed(60, 59.94), true);
    assert.equal(fpsAllowed(60, 50), false);
    assert.equal(fpsAllowed(30, 50), true);
});

test("refresh rate from frame intervals uses the median", () => {
    assert.equal(hzFromIntervals([5.6, 5.58, 5.59, 33, 5.6]), 179);
    assert.equal(hzFromIntervals([16.67, 16.66, 16.68]), 60);
    assert.equal(hzFromIntervals([]), 60);
});

test("labels", () => {
    assert.equal(heightLabel(1440), "1440p");
    assert.equal(heightLabel(0), "Исходное");
});

test("sanitize falls back per field on garbage", () => {
    assert.deepEqual(sanitizeQuality({ height: 1440, fps: 30, maxMbps: 80, prefer: "detail" }), { height: 1440, fps: 30, maxMbps: 80, prefer: "detail" });
    assert.deepEqual(sanitizeQuality({ height: 999, fps: "x", maxMbps: undefined, prefer: 5 }), DEFAULT_QUALITY);
});

test("needsRecapture: raising resolution or fps needs a new capture, lowering does not", () => {
    const at = (height: 720 | 1080 | 1440 | 0, fps: 30 | 60) => ({ height, fps, maxMbps: 20 as const, prefer: "fps" as const });
    assert.equal(needsRecapture(at(1080, 60), at(0, 60)), true);
    assert.equal(needsRecapture(at(720, 60), at(1440, 60)), true);
    assert.equal(needsRecapture(at(1080, 30), at(1080, 60)), true);
    assert.equal(needsRecapture(at(1440, 60), at(720, 30)), false);
    assert.equal(needsRecapture(at(0, 60), at(1440, 60)), false);
    assert.equal(needsRecapture(at(0, 60), at(0, 60)), false);
});

test("fps options stop at 60: Windows screen capture in Chromium never delivers more", () => {
    assert.deepEqual(FPS_OPTIONS, [30, 60]);
});

test("saved 120/144 from older versions fall back to 60", () => {
    assert.equal(sanitizeQuality({ height: 0, fps: 144, maxMbps: 80, prefer: "fps" }).fps, 60);
});

test("display media constraints", () => {
    assert.deepEqual(displayMediaConstraints({ height: 1440, fps: 60, maxMbps: 80, prefer: "fps" }), { height: { max: 1440 }, frameRate: { ideal: 60, max: 60 } });
    assert.deepEqual(displayMediaConstraints({ height: 0, fps: 30, maxMbps: 80, prefer: "fps" }), { frameRate: { ideal: 30, max: 30 } });
});
