/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ConnectSrc, CspPolicies } from "@main/csp";
import { RendererSettings } from "@main/settings";
import { app, desktopCapturer, IpcMainInvokeEvent } from "electron";
import { existsSync } from "fs";
import { join } from "path";

import type { TunnelPrepared, TunnelStatus } from "./net";
import { NetLoader } from "./netLoader";
import { relayCspSource } from "./relay";
import { Action, NET_FILE } from "./updateLogic";
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

/** pending — что ещё не сделано после обновлений этой сессии: перезапуск помнится до перезапуска */
export type CheckResult = UpdateResult & { pending: Action; };

// main-процесс живёт ровно до перезапуска Discord — флаг сбрасывается тем самым действием, которого ждёт
let restartPending = false;
const reloadPending = new WeakSet<Electron.WebContents>();

/** __dirname — папка dist, из которой Discord грузит Vencord */
export async function checkForUpdate(e: IpcMainInvokeEvent): Promise<CheckResult> {
    const r = await applyUpdate(__dirname);
    const win = e.sender;
    if (r.status === "updated" && r.action === "restart") restartPending = true;
    if (r.status === "updated" && r.action === "reload" && !reloadPending.has(win)) {
        reloadPending.add(win);
        win.once("did-navigate", () => reloadPending.delete(win));
    }
    // между звонками сразу подхватываем новый сетевой модуль: так и «ничего не нужно» правда, и битый
    // модуль виден сейчас, а не на следующем звонке. Не загрузился — старый работает, нужен перезапуск
    if (!net.current()?.activeCallId()) net.get();
    if (net.broken) restartPending = true;
    return { ...r, pending: restartPending ? "restart" : reloadPending.has(win) ? "reload" : "none" };
}

/** Первый переход со старой версии: сетевого модуля ещё нет — проверяем обновление сразу */
export function netMissing(_: IpcMainInvokeEvent) {
    return !existsSync(join(__dirname, NET_FILE));
}

/**
 * Запасной перезапуск. Только quit, не exit: Discord пишет токен входа на диск при штатном закрытии окна,
 * app.exit(0) это пропускает — и после перезапуска аккаунт разлогинен.
 */
export function relaunch(_: IpcMainInvokeEvent) {
    app.relaunch();
    app.quit();
}

// ── UDP-туннель (specs/001-udp-tunnel-upnp/contracts/tunnel.md §2) ──
// Сам туннель — в dist/p2pcall-net.js (net.ts): его код не должен попасть в patcher.js, иначе каждая его
// правка требовала бы перезапуска Discord. Здесь только загрузчик и IPC-обёртки.

export type { TunnelPrepared, TunnelStatus };

const net = new NetLoader(join(__dirname, NET_FILE), { userData: app.getPath("userData") }, undefined, () => !restartPending);
const closeAll = () => net.current()?.closeAll();
// проброс со сроком жизни истечёт и сам, но снять сразу вежливее
app.on("before-quit", closeAll);

const watched = new WeakSet<Electron.WebContents>();

/** Новый модуль подхватывается только здесь — после закрытия туннеля прошлого звонка, не посреди звонка */
export function tunnelPrepare(e: IpcMainInvokeEvent, callId: string): Promise<TunnelPrepared | null> {
    // Ctrl+R или падение рендерера: stop() плагина не выполнится, туннель и проброс закрываем сами
    if (!watched.has(e.sender)) {
        watched.add(e.sender);
        e.sender.on("did-navigate", closeAll);
        e.sender.on("render-process-gone", closeAll);
    }
    const cur = net.current();
    if (cur?.activeCallId() === callId) return cur.prepare(callId);
    cur?.closeAll();
    return net.get()?.prepare(callId) ?? Promise.resolve(null);
}

export async function tunnelSetPeer(_: IpcMainInvokeEvent, callId: string, peer: { addr: string; token: string; }) {
    await net.current()?.setPeer(callId, peer);
}

export function tunnelStatus(_: IpcMainInvokeEvent, callId: string): TunnelStatus | null {
    return net.current()?.status(callId) ?? null;
}

export function tunnelClose(_: IpcMainInvokeEvent, callId: string) {
    net.current()?.close(callId);
}
