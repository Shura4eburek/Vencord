/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { isNewer, nextVersion, parseManifest, sha256Hex, UPDATE_FILES } from "./updateLogic";

const hash = "a".repeat(64);
const files = Object.fromEntries(UPDATE_FILES.map(f => [f, hash]));

test("isNewer compares date then build number", () => {
    assert.equal(isNewer("2026.10.06-2", "2026.10.06-1"), true);
    assert.equal(isNewer("2026.10.07-1", "2026.10.06-9"), true);
    assert.equal(isNewer("2026.10.06-10", "2026.10.06-9"), true);
    assert.equal(isNewer("2026.10.06-1", "2026.10.06-1"), false);
    assert.equal(isNewer("2026.10.05-3", "2026.10.06-1"), false);
});

test("isNewer: unknown installed version means any valid remote is newer; garbage remote never is", () => {
    assert.equal(isNewer("2026.10.06-1", null), true);
    assert.equal(isNewer("junk", "2026.10.06-1"), false);
    assert.equal(isNewer("junk", null), false);
});

test("nextVersion bumps the build number within a day and resets on a new day", () => {
    assert.equal(nextVersion(new Date(2026, 9, 6), null), "2026.10.06-1");
    assert.equal(nextVersion(new Date(2026, 9, 6), "2026.10.06-3"), "2026.10.06-4");
    assert.equal(nextVersion(new Date(2026, 9, 7), "2026.10.06-3"), "2026.10.07-1");
});

test("parseManifest accepts exactly the expected files with sha256 hashes", () => {
    assert.deepEqual(parseManifest({ version: "2026.10.06-1", files }), { version: "2026.10.06-1", files });
});

test("parseManifest rejects bad versions, missing files, extra files, bad hashes", () => {
    assert.equal(parseManifest({ version: "x", files }), null);
    const { "renderer.js": _, ...missing } = files;
    assert.equal(parseManifest({ version: "2026.10.06-1", files: missing }), null);
    assert.equal(parseManifest({ version: "2026.10.06-1", files: { ...files, "../evil.js": hash } }), null);
    assert.equal(parseManifest({ version: "2026.10.06-1", files: { ...files, "renderer.js": "zz" } }), null);
    assert.equal(parseManifest(null), null);
});

test("sha256Hex", () => {
    assert.equal(sha256Hex(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
