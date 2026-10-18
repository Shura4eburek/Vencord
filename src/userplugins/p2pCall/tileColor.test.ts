/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { accentToHex, averageColor } from "./tileColor";

const px = (...rgba: number[][]) => new Uint8ClampedArray(rgba.flat());

test("uniform image gives its own color", () => {
    assert.equal(averageColor(px([237, 66, 69, 255], [237, 66, 69, 255])), "#ed4245");
});

test("transparent pixels are ignored", () => {
    assert.equal(averageColor(px([0, 0, 0, 0], [0, 0, 0, 0], [10, 20, 30, 255], [30, 20, 10, 200])), "#141414");
});

test("almost transparent image gives null", () => {
    const pixels = Array.from({ length: 20 }, (_, i) => (i === 0 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
    assert.equal(averageColor(px(...pixels)), null);
    assert.equal(averageColor(new Uint8ClampedArray()), null);
});

test("accent color int becomes #rrggbb", () => {
    assert.equal(accentToHex(0xff0000), "#ff0000");
    assert.equal(accentToHex(0x0000ff), "#0000ff");
});
