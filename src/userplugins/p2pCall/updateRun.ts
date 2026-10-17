/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { verify } from "crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

import { Action, ACTION_OF, isNewer, Manifest, parseManifest, parseManifestV2, RELEASE_REPO, sha256Hex, strongest, UPDATE_FILES, UpdateFile, VERSION_FILE } from "./updateLogic";

/**
 * Публичный ключ подписи релизов. Приватный лежит только у автора (%USERPROFILE%\.p2pcall\release-key.pem),
 * поэтому взлома одного GitHub недостаточно, чтобы раздать подменённую сборку.
 */
export const RELEASE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAQtL9g1+P3jdGnHihcyQueCTOy1W2at34j95kHcoLKOI=
-----END PUBLIC KEY-----`;

export type UpdateResult =
    | { status: "dev" | "latest"; version: string | null; }
    /** action — что сделать, чтобы заработала новая версия; changed — какие файлы подменены */
    | { status: "updated"; version: string; action: Action; changed: string[]; }
    | { status: "error"; error: string; };

const UA = { "User-Agent": "P2PCall-updater" };

async function download(fetchFn: typeof fetch, url: string): Promise<Uint8Array> {
    const res = await fetchFn(url, { headers: UA, redirect: "follow" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
    return new Uint8Array(await res.arrayBuffer());
}

const diskHash = (path: string) => existsSync(path) ? sha256Hex(readFileSync(path)) : null;

/**
 * Последний релиз форка: подпись манифеста → версия → файлы по sha256 → атомарная подмена в dist.
 * С manifest-v2 качаются только файлы, отличающиеся от лежащих на диске (сборка релиза детерминирована),
 * и по ним выбирается действие (specs/002-update-apply-modes). Релиз без v2 — как раньше, с перезапуском.
 */
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

        const v2 = release.assets?.some(a => a.name === "manifest-v2.json");
        const signed = async (name: string) => {
            const bytes = await download(fetchFn, asset(name + ".json"));
            const sig = await download(fetchFn, asset(name + ".sig"));
            if (!verify(null, bytes, publicKey, sig)) throw new Error("подпись релиза не сошлась — обновление отклонено");
            return JSON.parse(new TextDecoder().decode(bytes));
        };
        const manifest: Manifest | null = v2 ? parseManifestV2(await signed("manifest-v2")) : parseManifest(await signed("manifest"));
        if (!manifest) throw new Error(v2 ? "битый manifest-v2.json" : "битый manifest.json");
        const newer = isNewer(manifest.version, installed);

        const names = Object.keys(manifest.files) as UpdateFile[];
        // та же версия — только докачать отсутствующее (первый переход: старое обновление не знало net-модуль)
        // более старый релиз (удалён новейший, повтор старого манифеста) не трогаем вовсе
        const repair = v2 && !newer && manifest.version === installed;
        const changed = !v2
            ? (newer ? [...UPDATE_FILES] : [])
            : newer ? names.filter(n => diskHash(join(dist, n)) !== manifest.files[n])
                : repair ? names.filter(n => !existsSync(join(dist, n))) : [];
        if (!changed.length) {
            if (newer) writeFileSync(versionPath, manifest.version);
            return newer ? { status: "updated", version: manifest.version, action: "none", changed } : { status: "latest", version: installed };
        }

        // всё скачиваем и проверяем во временные файлы, подменяем только если всё сошлось
        for (const name of changed) {
            const data = await download(fetchFn, asset(name));
            if (sha256Hex(data) !== manifest.files[name]) throw new Error(`не совпала контрольная сумма ${name}`);
            const path = join(dist, name + ".p2p-tmp");
            writeFileSync(path, data);
            tmp.push(path);
        }
        for (const name of changed) renameSync(join(dist, name + ".p2p-tmp"), join(dist, name));
        tmp.length = 0;
        // докачка в той же версии — не «обновление»: модуль подхватится со следующего звонка
        if (repair) return { status: "latest", version: installed };
        writeFileSync(versionPath, manifest.version);
        const action = v2 ? strongest(changed.map(n => ACTION_OF[n])) : "restart";
        return { status: "updated", version: manifest.version, action, changed };
    } catch (e) {
        return { status: "error", error: String((e as Error)?.message ?? e) };
    } finally {
        for (const p of tmp) rmSync(p, { force: true });
    }
}
