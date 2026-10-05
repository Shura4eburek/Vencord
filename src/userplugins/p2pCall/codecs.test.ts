/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { chooseCodec, EMPTY_CAPS, isCaps, orderCodecs, probeCaps } from "./codecs";

const all = { encodeHw: ["video/AV1", "video/H264", "video/VP9"], decodeHw: ["video/AV1", "video/H264", "video/VP9"] };

test("auto picks AV1 when both sides do it in hardware", () => {
    assert.equal(chooseCodec("auto", all, all), "video/AV1");
});

test("auto skips AV1 when the peer can't decode it in hardware", () => {
    assert.equal(chooseCodec("auto", all, { encodeHw: [], decodeHw: ["video/H264", "video/VP9"] }), "video/H264");
});

test("auto skips a codec we can't encode in hardware", () => {
    assert.equal(chooseCodec("auto", { encodeHw: ["video/VP9"], decodeHw: [] }, all), "video/VP9");
});

test("no peer caps yet or no common codec → H264", () => {
    assert.equal(chooseCodec("auto", all, null), "video/H264");
    assert.equal(chooseCodec("auto", EMPTY_CAPS, EMPTY_CAPS), "video/H264");
});

test("manual choice wins", () => {
    assert.equal(chooseCodec("video/VP9", all, all), "video/VP9");
});

test("orderCodecs moves every entry of the chosen codec first, keeps the rest in order", () => {
    const caps = [
        { mimeType: "video/VP8", n: 1 },
        { mimeType: "video/H264", n: 2 },
        { mimeType: "video/rtx", n: 3 },
        { mimeType: "video/H264", n: 4 },
        { mimeType: "video/AV1", n: 5 },
    ];
    assert.deepEqual(orderCodecs(caps, "video/H264").map(c => c.n), [2, 4, 1, 3, 5]);
    assert.equal(orderCodecs(caps, "video/H264").length, caps.length);
});

test("probeCaps keeps only supported and power-efficient codecs", async () => {
    const mc = {
        encodingInfo: async (cfg: any) => ({ supported: true, smooth: true, powerEfficient: cfg.video.contentType !== "video/VP9" }),
        decodingInfo: async (cfg: any) => ({ supported: cfg.video.contentType !== "video/AV1", smooth: true, powerEfficient: true }),
    } as any;
    assert.deepEqual(await probeCaps(mc), { encodeHw: ["video/AV1", "video/H264"], decodeHw: ["video/H264", "video/VP9"] });
});

test("probeCaps survives a throwing or missing mediaCapabilities", async () => {
    const bad = { encodingInfo: async () => { throw new Error("no"); }, decodingInfo: async () => { throw new Error("no"); } } as any;
    assert.deepEqual(await probeCaps(bad), EMPTY_CAPS);
    assert.deepEqual(await probeCaps(undefined), EMPTY_CAPS);
});

test("isCaps validates the ctl message payload", () => {
    assert.equal(isCaps({ encodeHw: ["video/AV1"], decodeHw: [] }), true);
    assert.equal(isCaps({ encodeHw: "video/AV1", decodeHw: [] }), false);
    assert.equal(isCaps(null), false);
});
