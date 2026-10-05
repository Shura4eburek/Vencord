/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ConnectSrc, CspPolicies } from "@main/csp";
import { RendererSettings } from "@main/settings";
import { app, desktopCapturer, IpcMainInvokeEvent } from "electron";

import { relayCspSource } from "./relay";
import { applyUpdate, UpdateResult } from "./updateRun";

export type { UpdateResult };

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

let pendingSource: string | null = null;
const handled = new WeakSet<Electron.Session>();

/**
 * getDisplayMedia в Discord выключен (нет обработчика → NotSupported). Ставим свой, который отдаёт источник,
 * выбранный в нашем окне выбора. Нужен для демки выше 60 FPS: legacy-захват выше не пускает.
 */
export function prepareDisplayMedia(e: IpcMainInvokeEvent, sourceId: string) {
    pendingSource = sourceId;
    const ses = e.sender.session;
    if (handled.has(ses)) return;
    handled.add(ses);
    ses.setDisplayMediaRequestHandler((_req, callback) => {
        const id = pendingSource;
        pendingSource = null;
        if (!id) { callback({}); return; }
        desktopCapturer.getSources({ types: ["screen", "window"] }).then(
            list => { const s = list.find(x => x.id === id); callback(s ? { video: s } : {}); },
            () => callback({}),
        );
    });
}

export async function getSources(_: IpcMainInvokeEvent): Promise<ScreenSource[]> {
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 } });
    return sources.map(s => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() }));
}

/** __dirname — папка dist, из которой Discord грузит Vencord */
export function checkForUpdate(_: IpcMainInvokeEvent): Promise<UpdateResult> {
    return applyUpdate(__dirname);
}

export function relaunch(_: IpcMainInvokeEvent) {
    app.relaunch();
    app.exit(0);
}
