/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_OPUS, tuneOpus } from "./sdp";

const SDP = [
    "v=0",
    "o=- 1 2 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111 0",
    "a=rtpmap:111 opus/48000/2",
    "a=fmtp:111 minptime=20;useinbandfec=0;stereo=0",
    "a=rtpmap:0 PCMU/8000",
    "m=video 9 UDP/TLS/RTP/SAVPF 96",
    "a=rtpmap:96 VP8/90000",
    "",
].join("\r\n");

test("rewrites opus fmtp, keeps foreign params", () => {
    const out = tuneOpus(SDP, DEFAULT_OPUS);
    assert.match(out, /a=fmtp:111 minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=128000\r\n/);
});

test("adds a=ptime inside the audio section only", () => {
    const lines = tuneOpus(SDP, DEFAULT_OPUS).split("\r\n");
    const ptime = lines.indexOf("a=ptime:10");
    assert.ok(ptime > lines.indexOf("m=audio 9 UDP/TLS/RTP/SAVPF 111 0"));
    assert.ok(ptime < lines.findIndex(l => l.startsWith("m=video")));
});

test("adds fmtp when opus has none", () => {
    const noFmtp = SDP.replace("a=fmtp:111 minptime=20;useinbandfec=0;stereo=0\r\n", "");
    assert.match(tuneOpus(noFmtp, DEFAULT_OPUS), /a=rtpmap:111 opus\/48000\/2\r\na=fmtp:111 useinbandfec=1;maxaveragebitrate=128000;minptime=10\r\n/);
});

test("replaces an existing ptime", () => {
    const withPtime = SDP.replace("a=rtpmap:0 PCMU/8000", "a=rtpmap:0 PCMU/8000\r\na=ptime:20");
    const out = tuneOpus(withPtime, DEFAULT_OPUS);
    assert.ok(out.includes("a=ptime:10"));
    assert.ok(!out.includes("a=ptime:20"));
});

test("sdp without opus is returned unchanged", () => {
    const video = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n";
    assert.equal(tuneOpus(video, DEFAULT_OPUS), video);
});

test("sdp keeps trailing CRLF", () => {
    assert.ok(tuneOpus(SDP, DEFAULT_OPUS).endsWith("\r\n"));
});
