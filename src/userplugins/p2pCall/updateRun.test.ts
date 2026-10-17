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

import { NET_FILE, sha256Hex, UPDATE_FILES, UPDATE_FILES_V2, VERSION_FILE } from "./updateLogic";
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
    assert.deepEqual(await applyUpdate(d, release("2026.10.05-2"), PUB), { status: "updated", version: "2026.10.05-2", action: "restart", changed: [...UPDATE_FILES] });
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

const enc = (s: string) => new TextEncoder().encode(s);

/** Релиз с обоими манифестами; содержимое файлов задаётся явно, чтобы совпадать или нет с диском */
function releaseV2(version: string, content: Record<string, string>, key = privateKey) {
    const bytes = Object.fromEntries(UPDATE_FILES_V2.map(f => [f, enc(content[f])]));
    const m1 = enc(JSON.stringify({ version, files: Object.fromEntries(UPDATE_FILES.map(f => [f, sha256Hex(bytes[f])])) }));
    const m2 = enc(JSON.stringify({ schema: 2, version, files: Object.fromEntries(UPDATE_FILES_V2.map(f => [f, sha256Hex(bytes[f])])) }));
    const assets: Record<string, Uint8Array> = {
        ...bytes,
        "manifest.json": m1, "manifest.sig": new Uint8Array(sign(null, m1, key)),
        "manifest-v2.json": m2, "manifest-v2.sig": new Uint8Array(sign(null, m2, key)),
    };
    const fetched: string[] = [];
    const fetchFn = (async (url: string) => {
        if (url.includes("/releases/latest")) return new Response(JSON.stringify({ assets: Object.keys(assets).map(name => ({ name, browser_download_url: `https://dl/${name}` })) }));
        const name = url.replace("https://dl/", "");
        fetched.push(name);
        return assets[name] ? new Response(assets[name] as BodyInit) : new Response("nope", { status: 404 });
    }) as typeof fetch;
    return { fetchFn, fetched };
}

const SAME = Object.fromEntries(UPDATE_FILES_V2.map(f => [f, "old"]));

function distV2(installed: string, onDisk: Record<string, string | null> = SAME) {
    const root = mkdtempSync(join(tmpdir(), "p2p-upd2-"));
    const d = join(root, "dist");
    mkdirSync(d);
    for (const [f, c] of Object.entries(onDisk)) if (c !== null) writeFileSync(join(d, f), c);
    writeFileSync(join(d, VERSION_FILE), installed);
    return d;
}

const files = (r: { fetched: string[]; }) => r.fetched.filter(n => !n.startsWith("manifest"));

test("v2: only renderer.js changed → reload, only it is downloaded", async () => {
    const d = distV2("2026.10.18-1");
    const r = releaseV2("2026.10.18-2", { ...SAME, "renderer.js": "new ui" });
    assert.deepEqual(await applyUpdate(d, r.fetchFn, PUB), { status: "updated", version: "2026.10.18-2", action: "reload", changed: ["renderer.js"] });
    assert.deepEqual(files(r), ["renderer.js"]);
    assert.equal(readFileSync(join(d, "renderer.js"), "utf8"), "new ui");
    assert.equal(readFileSync(join(d, VERSION_FILE), "utf8"), "2026.10.18-2");
});

test("v2: only the net module changed → nothing to do", async () => {
    const d = distV2("2026.10.18-1");
    const r = releaseV2("2026.10.18-2", { ...SAME, [NET_FILE]: "new tunnel" });
    const res = await applyUpdate(d, r.fetchFn, PUB);
    assert.equal(res.status === "updated" && res.action, "none");
    assert.equal(readFileSync(join(d, NET_FILE), "utf8"), "new tunnel");
});

test("v2: patcher.js and renderer.js changed → restart wins", async () => {
    const d = distV2("2026.10.18-1");
    const r = releaseV2("2026.10.18-2", { ...SAME, "patcher.js": "new main", "renderer.js": "new ui" });
    const res = await applyUpdate(d, r.fetchFn, PUB);
    assert.equal(res.status === "updated" && res.action, "restart");
    assert.deepEqual(files(r).sort(), ["patcher.js", "renderer.js"]);
});

test("v2: newer version with identical files → updated, nothing downloaded", async () => {
    const d = distV2("2026.10.18-1");
    const r = releaseV2("2026.10.18-2", SAME);
    assert.deepEqual(await applyUpdate(d, r.fetchFn, PUB), { status: "updated", version: "2026.10.18-2", action: "none", changed: [] });
    assert.deepEqual(files(r), []);
});

test("v2: same version but the net module is missing (first switch from an old install) → it is fetched", async () => {
    const d = distV2("2026.10.18-2", { ...SAME, [NET_FILE]: null });
    const r = releaseV2("2026.10.18-2", { ...SAME, [NET_FILE]: "tunnel" });
    assert.deepEqual(await applyUpdate(d, r.fetchFn, PUB), { status: "latest", version: "2026.10.18-2" });
    assert.equal(readFileSync(join(d, NET_FILE), "utf8"), "tunnel");
});

test("v2: an older release is never applied, even to fill a missing file", async () => {
    const d = distV2("2026.10.18-5", { ...SAME, [NET_FILE]: null });
    const r = releaseV2("2026.10.18-3", { ...SAME, [NET_FILE]: "old tunnel" });
    assert.deepEqual(await applyUpdate(d, r.fetchFn, PUB), { status: "latest", version: "2026.10.18-5" });
    assert.equal(existsSync(join(d, NET_FILE)), false);
    assert.equal(readFileSync(join(d, VERSION_FILE), "utf8"), "2026.10.18-5");
});

test("v2: same version, all files present → latest", async () => {
    const d = distV2("2026.10.18-2");
    assert.deepEqual(await applyUpdate(d, releaseV2("2026.10.18-2", { ...SAME, "renderer.js": "x" }).fetchFn, PUB), { status: "latest", version: "2026.10.18-2" });
});

test("v2: manifest-v2 signed by another key → error, nothing replaced", async () => {
    const d = distV2("2026.10.18-1");
    const res = await applyUpdate(d, releaseV2("2026.10.18-2", { ...SAME, "renderer.js": "evil" }, other.privateKey).fetchFn, PUB);
    assert.equal(res.status, "error");
    assert.equal(readFileSync(join(d, "renderer.js"), "utf8"), "old");
});
