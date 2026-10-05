/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeStats } from "./stats";

const base = (over: { local?: string; remote?: string; lost?: number; received?: number; recv?: number; sent?: number; }) => [
    { type: "transport", id: "T", selectedCandidatePairId: "P" },
    { type: "candidate-pair", id: "P", localCandidateId: "L", remoteCandidateId: "R", currentRoundTripTime: 0.004 },
    { type: "local-candidate", id: "L", candidateType: over.local ?? "srflx" },
    { type: "remote-candidate", id: "R", candidateType: over.remote ?? "host" },
    { type: "inbound-rtp", id: "I", kind: "audio", packetsLost: over.lost ?? 0, packetsReceived: over.received ?? 100, bytesReceived: over.recv ?? 1000 },
    { type: "outbound-rtp", id: "O", kind: "audio", bytesSent: over.sent ?? 2000 },
];

test("rtt in ms and srflx path", () => {
    const s = summarizeStats(base({}), 1000);
    assert.equal(s.rttMs, 4);
    assert.equal(s.path, "srflx");
});

test("relay wins over srflx", () => {
    assert.equal(summarizeStats(base({ remote: "relay" }), 0).path, "relay");
});

test("host+host is host, prflx counts as srflx", () => {
    assert.equal(summarizeStats(base({ local: "host", remote: "host" }), 0).path, "host");
    assert.equal(summarizeStats(base({ local: "prflx", remote: "host" }), 0).path, "srflx");
});

test("loss and bitrate are deltas against prev counters", () => {
    const first = summarizeStats(base({ lost: 0, received: 100, recv: 1000, sent: 2000 }), 1000);
    const second = summarizeStats(base({ lost: 5, received: 195, recv: 126000, sent: 252000 }), 2000, first.counters);
    assert.equal(second.lossPct, 5);
    assert.equal(second.inKbps, 1000);
    assert.equal(second.outKbps, 2000);
});

test("no selected pair → unknown path, null rtt", () => {
    const s = summarizeStats([{ type: "transport", id: "T" }], 0);
    assert.equal(s.path, "unknown");
    assert.equal(s.rttMs, null);
});

const video = [
    { type: "codec", id: "CAV1", mimeType: "video/AV1" },
    { type: "codec", id: "CH264", mimeType: "video/H264" },
    { type: "outbound-rtp", id: "OC", kind: "video", frameWidth: 1280, frameHeight: 720, framesPerSecond: 30, codecId: "CH264", powerEfficientEncoder: true, qualityLimitationReason: "none", bytesSent: 0 },
    { type: "outbound-rtp", id: "OS", kind: "video", frameWidth: 2560, frameHeight: 1440, framesPerSecond: 118, codecId: "CAV1", powerEfficientEncoder: true, qualityLimitationReason: "bandwidth", bytesSent: 0 },
    { type: "inbound-rtp", id: "IS", kind: "video", frameWidth: 1920, frameHeight: 1080, framesPerSecond: 60, codecId: "CH264", powerEfficientDecoder: false, packetsLost: 0, packetsReceived: 0, bytesReceived: 0 },
];

test("video out is the biggest outgoing stream (screen over camera)", () => {
    const s = summarizeStats([...base({}), ...video], 0);
    assert.deepEqual(s.video.out, { width: 2560, height: 1440, fps: 118, codec: "video/AV1", hw: true, limit: "bandwidth" });
});

test("video in reports decoder and has no limit", () => {
    const s = summarizeStats([...base({}), ...video], 0);
    assert.deepEqual(s.video.in, { width: 1920, height: 1080, fps: 60, codec: "video/H264", hw: false, limit: null });
});

test("no video → nulls; unknown limit → other; missing hw flag → null", () => {
    assert.deepEqual(summarizeStats(base({}), 0).video, { out: null, in: null });
    const s = summarizeStats([{ type: "outbound-rtp", id: "O", kind: "video", frameWidth: 10, frameHeight: 10, framesPerSecond: 1, qualityLimitationReason: "weird" }], 0);
    assert.deepEqual(s.video.out, { width: 10, height: 10, fps: 1, codec: null, hw: null, limit: "other" });
});
