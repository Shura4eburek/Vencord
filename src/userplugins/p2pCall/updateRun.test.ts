/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { sha256Hex, UPDATE_FILES, VERSION_FILE } from "./updateLogic";
import { applyUpdate } from "./updateRun";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB = publicKey.export({ type: "spki", format: "pem" }).toString();
const other = generateKeyPairSync("ed25519");

function release(version: string, key = privateKey, tamper?: string) {
    const content: Record<string, Uint8Array> = {};
    for (const f of UPDATE_FILES) content[f] = new TextEncoder().encode(`${f} v${version}`);
    const manifest = new TextEncoder().encode(JSON.stringify({ version, files: Object.fromEntries(UPDATE_FILES.map(f => [f, sha256Hex(content[f])])) }));
    const sig = sign(null, manifest, key);
    if (tamper) content[tamper] = new TextEncoder().encode("evil");
    const assets: Record<string, Uint8Array> = { ...content, "manifest.json": manifest, "manifest.sig": new Uint8Array(sig) };
    const fetchFn = (async (url: string) => {
        if (url.includes("/releases/latest")) {
            return new Response(JSON.stringify({ assets: Object.keys(assets).map(name => ({ name, browser_download_url: `https://dl/${name}` })) }));
        }
        const name = url.replace("https://dl/", "");
        return assets[name] ? new Response(assets[name] as BodyInit) : new Response("nope", { status: 404 });
    }) as typeof fetch;
    return fetchFn;
}

function dist(installed: string | null, git = false) {
    const root = mkdtempSync(join(tmpdir(), "p2p-upd-"));
    const d = join(root, "dist");
    mkdirSync(d);
    for (const f of UPDATE_FILES) writeFileSync(join(d, f), "old");
    if (installed) writeFileSync(join(d, VERSION_FILE), installed);
    if (git) mkdirSync(join(root, ".git"));
    return d;
}

test("installs a newer signed release and records the version", async () => {
    const d = dist("2026.10.05-1");
    assert.deepEqual(await applyUpdate(d, release("2026.10.05-2"), PUB), { status: "updated", version: "2026.10.05-2" });
    assert.equal(readFileSync(join(d, "renderer.js"), "utf8"), "renderer.js v2026.10.05-2");
    assert.equal(readFileSync(join(d, VERSION_FILE), "utf8"), "2026.10.05-2");
});

test("same version is reported as latest and nothing changes", async () => {
    const d = dist("2026.10.05-2");
    assert.deepEqual(await applyUpdate(d, release("2026.10.05-2"), PUB), { status: "latest", version: "2026.10.05-2" });
    assert.equal(readFileSync(join(d, "renderer.js"), "utf8"), "old");
});

test("manifest signed by another key is rejected, files untouched", async () => {
    const d = dist("2026.10.05-1");
    const r = await applyUpdate(d, release("2026.10.05-2", other.privateKey), PUB);
    assert.equal(r.status, "error");
    for (const f of UPDATE_FILES) assert.equal(readFileSync(join(d, f), "utf8"), "old");
});

test("a file not matching the signed hash aborts the whole update, no temp files left", async () => {
    const d = dist("2026.10.05-1");
    const r = await applyUpdate(d, release("2026.10.05-2", privateKey, "renderer.js"), PUB);
    assert.equal(r.status, "error");
    for (const f of UPDATE_FILES) {
        assert.equal(readFileSync(join(d, f), "utf8"), "old");
        assert.equal(existsSync(join(d, f + ".p2p-tmp")), false);
    }
});

test("a git checkout is never updated", async () => {
    const d = dist(null, true);
    assert.equal((await applyUpdate(d, release("2026.10.05-2"), PUB)).status, "dev");
    assert.equal(readFileSync(join(d, "renderer.js"), "utf8"), "old");
});
