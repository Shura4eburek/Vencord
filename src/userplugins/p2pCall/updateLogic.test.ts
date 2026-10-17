/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ACTION_OF, isNewer, NET_FILE, nextVersion, parseManifest, parseManifestV2, sha256Hex, strongest, UPDATE_FILES, UPDATE_FILES_V2 } from "./updateLogic";

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

test("each update file maps to its apply action", () => {
    assert.deepEqual(UPDATE_FILES_V2.map(f => ACTION_OF[f]), ["restart", "restart", "reload", "reload", "none"]);
    assert.equal(NET_FILE, "p2pcall-net.js");
});

test("strongest picks restart over reload over none", () => {
    assert.equal(strongest([]), "none");
    assert.equal(strongest(["none", "reload"]), "reload");
    assert.equal(strongest(["reload", "restart", "none"]), "restart");
});

test("parseManifestV2 wants schema 2 and exactly the five files; v1 still wants four", () => {
    const v2 = { schema: 2, version: "2026.10.18-3", files: Object.fromEntries(UPDATE_FILES_V2.map(f => [f, hash])) };
    assert.equal(parseManifestV2(v2)?.files[NET_FILE], hash);
    assert.equal(parseManifestV2({ ...v2, schema: 1 }), null);
    assert.equal(parseManifestV2({ ...v2, files: files }), null);
    assert.equal(parseManifestV2({ ...v2, files: { ...v2.files, "evil.js": hash } }), null);
    assert.equal(parseManifest(v2), null, "old installs reject the v2 file list");
    assert.ok(parseManifest({ version: "2026.10.18-3", files }));
});
