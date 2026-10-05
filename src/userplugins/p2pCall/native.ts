/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ConnectSrc, CspPolicies } from "@main/csp";
import { RendererSettings } from "@main/settings";
import { app, desktopCapturer, IpcMainInvokeEvent } from "electron";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

import { relayCspSource } from "./relay";
import { isNewer, parseManifest, RELEASE_REPO, sha256Hex, UPDATE_FILES, VERSION_FILE } from "./updateLogic";

const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://nostr.mom"];

function allowRelays() {
    const raw = (RendererSettings.store.plugins?.P2PCall as { relays?: string; } | undefined)?.relays;
    const urls = raw ? raw.split(",").map(s => s.trim()).filter(Boolean) : [];
    for (const u of [...DEFAULT_RELAYS, ...urls]) {
        const src = relayCspSource(u);
        if (src) CspPolicies[src] = ConnectSrc;
    }
}
allowRelays();

export interface ScreenSource { id: string; name: string; thumb: string; }

export async function getSources(_: IpcMainInvokeEvent): Promise<ScreenSource[]> {
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 } });
    return sources.map(s => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() }));
}

export type UpdateResult =
    | { status: "dev" | "latest"; version: string | null; }
    | { status: "updated"; version: string; }
    | { status: "error"; error: string; };

const UA = { "User-Agent": "P2PCall-updater" };

async function download(url: string): Promise<Uint8Array> {
    const res = await fetch(url, { headers: UA, redirect: "follow" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
    return new Uint8Array(await res.arrayBuffer());
}

/** Проверка последнего релиза форка и подмена файлов сборки в своей папке dist */
export async function checkForUpdate(_: IpcMainInvokeEvent): Promise<UpdateResult> {
    // __dirname — папка dist, из которой Discord грузит Vencord
    const dist = __dirname;
    const versionPath = join(dist, VERSION_FILE);
    const installed = existsSync(versionPath) ? readFileSync(versionPath, "utf8").trim() : null;
    // рабочий репозиторий: сборки из релиза перетёрли бы разработку
    if (existsSync(join(dist, "..", ".git"))) return { status: "dev", version: installed };

    const tmp: string[] = [];
    try {
        const res = await fetch(`https://api.github.com/repos/${RELEASE_REPO}/releases/latest`, { headers: { ...UA, Accept: "application/vnd.github+json" } });
        if (!res.ok) throw new Error(`GitHub ${res.status}`);
        const release = await res.json() as { assets?: { name: string; browser_download_url: string; }[]; };
        const asset = (name: string) => release.assets?.find(a => a.name === name)?.browser_download_url;

        const manifestUrl = asset("manifest.json");
        if (!manifestUrl) throw new Error("в релизе нет manifest.json");
        const manifest = parseManifest(JSON.parse(new TextDecoder().decode(await download(manifestUrl))));
        if (!manifest) throw new Error("битый manifest.json");
        if (!isNewer(manifest.version, installed)) return { status: "latest", version: installed };

        // всё скачиваем и проверяем во временные файлы, подменяем только если всё сошлось
        for (const name of UPDATE_FILES) {
            const url = asset(name);
            if (!url) throw new Error(`в релизе нет ${name}`);
            const data = await download(url);
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

export function relaunch(_: IpcMainInvokeEvent) {
    app.relaunch();
    app.exit(0);
}
