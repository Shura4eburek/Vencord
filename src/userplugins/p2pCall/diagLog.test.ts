/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { compactStats, videoLabel } from "./diagLog";
import type { CallStats } from "./stats";

const s: CallStats = {
    rttMs: 3, lossPct: 0.5, inKbps: 900, outKbps: 38000, path: "srflx",
    counters: { at: 0, recvBytes: 0, sentBytes: 0, lost: 0, received: 0 },
    video: {
        out: { width: 2560, height: 1440, fps: 118, codec: "video/AV1", hw: true, limit: "bandwidth", srcFps: 144 },
        in: null,
    },
};

test("compactStats keeps what matters and drops raw counters", () => {
    assert.deepEqual(compactStats(s), {
        rtt: 3, loss: 0.5, inKbps: 900, outKbps: 38000, path: "srflx",
        vOut: "2560x1440@118 AV1 hw limit=bandwidth src=144fps", vIn: null,
    });
});

test("videoLabel for the chip", () => {
    assert.equal(videoLabel(s.video.out!), "1440p · 118 FPS · AV1 (аппаратный) · ограничение: канал");
    assert.equal(videoLabel({ width: 1280, height: 720, fps: 30, codec: "video/VP9", hw: false, limit: "none", srcFps: null }), "720p · 30 FPS · VP9 (программный)");
    assert.equal(videoLabel({ width: 1280, height: 720, fps: 30, codec: null, hw: null, limit: null, srcFps: null }), "720p · 30 FPS");
});
