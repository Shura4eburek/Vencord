/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { verify } from "crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

import { isNewer, parseManifest, RELEASE_REPO, sha256Hex, UPDATE_FILES, VERSION_FILE } from "./updateLogic";

/**
 * Публичный ключ подписи релизов. Приватный лежит только у автора (%USERPROFILE%\.p2pcall\release-key.pem),
 * поэтому взлома одного GitHub недостаточно, чтобы раздать подменённую сборку.
 */
export const RELEASE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAQtL9g1+P3jdGnHihcyQueCTOy1W2at34j95kHcoLKOI=
-----END PUBLIC KEY-----`;

export type UpdateResult =
    | { status: "dev" | "latest"; version: string | null; }
    | { status: "updated"; version: string; }
    | { status: "error"; error: string; };

const UA = { "User-Agent": "P2PCall-updater" };

async function download(fetchFn: typeof fetch, url: string): Promise<Uint8Array> {
    const res = await fetchFn(url, { headers: UA, redirect: "follow" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
    return new Uint8Array(await res.arrayBuffer());
}

/** Последний релиз форка: подпись манифеста → версия → файлы по sha256 → атомарная подмена в dist */
export async function applyUpdate(dist: string, fetchFn: typeof fetch = fetch, publicKey = RELEASE_PUBLIC_KEY): Promise<UpdateResult> {
    const versionPath = join(dist, VERSION_FILE);
    const installed = existsSync(versionPath) ? readFileSync(versionPath, "utf8").trim() : null;
    // рабочий репозиторий: сборки из релиза перетёрли бы разработку
    if (existsSync(join(dist, "..", ".git"))) return { status: "dev", version: installed };

    const tmp: string[] = [];
    try {
        const res = await fetchFn(`https://api.github.com/repos/${RELEASE_REPO}/releases/latest`, { headers: { ...UA, Accept: "application/vnd.github+json" } });
        if (!res.ok) throw new Error(`GitHub ${res.status}`);
        const release = await res.json() as { assets?: { name: string; browser_download_url: string; }[]; };
        const asset = (name: string) => {
            const url = release.assets?.find(a => a.name === name)?.browser_download_url;
            if (!url) throw new Error(`в релизе нет ${name}`);
            return url;
        };

        const manifestBytes = await download(fetchFn, asset("manifest.json"));
        const sig = await download(fetchFn, asset("manifest.sig"));
        if (!verify(null, manifestBytes, publicKey, sig)) throw new Error("подпись релиза не сошлась — обновление отклонено");
        const manifest = parseManifest(JSON.parse(new TextDecoder().decode(manifestBytes)));
        if (!manifest) throw new Error("битый manifest.json");
        if (!isNewer(manifest.version, installed)) return { status: "latest", version: installed };

        // всё скачиваем и проверяем во временные файлы, подменяем только если всё сошлось
        for (const name of UPDATE_FILES) {
            const data = await download(fetchFn, asset(name));
            if (sha256Hex(data) !== manifest.files[name]) throw new Error(`не совпала контрольная сумма ${name}`);
            const path = join(dist, name + ".p2p-tmp");
            writeFileSync(path, data);
            tmp.push(path);
        }
        for (const name of UPDATE_FILES) renameSync(join(dist, name + ".p2p-tmp"), join(dist, name));
        tmp.length = 0;
        writeFileSync(versionPath, manifest.version);
        return { status: "updated", version: manifest.version };
    } catch (e) {
        return { status: "error", error: String((e as Error)?.message ?? e) };
    } finally {
        for (const p of tmp) rmSync(p, { force: true });
    }
}
