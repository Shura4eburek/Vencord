/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ConnectSrc, CspPolicies } from "@main/csp";
import { RendererSettings } from "@main/settings";
import { randomBytes } from "crypto";
import dgram from "dgram";
import { app, desktopCapturer, IpcMainInvokeEvent } from "electron";
import { readFileSync, rmSync, writeFileSync } from "fs";
import { networkInterfaces } from "os";
import { join } from "path";

import { relayCspSource } from "./relay";
import { Tunnel, TunnelStatus } from "./tunnel";
import { isPeerAddr } from "./tunnelWire";
import { applyUpdate, UpdateResult } from "./updateRun";
import { defaultLanIp, deletePortMapping, discoverIgd, httpRequest, Igd, PortMapping, UpnpDeps } from "./upnp";

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

/**
 * Запасной перезапуск. Только quit, не exit: Discord пишет токен входа на диск при штатном закрытии окна,
 * app.exit(0) это пропускает — и после перезапуска аккаунт разлогинен.
 */
export function relaunch(_: IpcMainInvokeEvent) {
    app.relaunch();
    app.quit();
}

// ── UDP-туннель (specs/001-udp-tunnel-upnp/contracts/tunnel.md §2) ──

export type { TunnelStatus };
export interface TunnelPrepared { addr: string | null; token: string; upnp: "ok" | "no-igd" | "error"; lanIp: string; proxyPort: number; }
interface ActiveTunnel { callId: string; ready: Promise<TunnelPrepared | null>; tunnel?: Tunnel; mapping?: PortMapping; closed: boolean; }

const PORT_BASE = 40000;
const PORT_TRIES = 5;
const udp = () => dgram.createSocket("udp4");
const upnpDeps: UpnpDeps = { createSocket: udp, request: httpRequest };
let active: ActiveTunnel | null = null;
// описание роутера не меняется — второй звонок не ждёт SSDP
let igdCache: { lanIp: string; igd: Igd; } | null = null;

/**
 * Проброс, который мог остаться после падения Discord: у роутеров без срока жизни (код 725) он иначе
 * живёт до перезагрузки роутера. Запоминаем его на диске и снимаем при следующем звонке.
 */
const staleFile = () => join(app.getPath("userData"), "p2pcall-upnp.json");

function rememberMapping(m: PortMapping | null) {
    try {
        if (m) writeFileSync(staleFile(), JSON.stringify({ port: m.port, igd: m.igd }));
        else rmSync(staleFile(), { force: true });
    } catch { }
}

function dropStaleMapping() {
    let saved: { port: number; igd: Igd; };
    try { saved = JSON.parse(readFileSync(staleFile(), "utf8")); } catch { return; }
    if (typeof saved?.port !== "number" || typeof saved.igd?.controlUrl !== "string") { rememberMapping(null); return; }
    // запись стираем, только если роутер подтвердил удаление, — иначе попробуем в следующий раз
    deletePortMapping(saved.igd, saved.port, upnpDeps).then(ok => { if (ok && !active?.mapping) rememberMapping(null); });
}

function localIps() {
    const ips = new Set(["127.0.0.1"]);
    for (const list of Object.values(networkInterfaces())) for (const i of list ?? []) ips.add(i.address);
    return ips;
}

async function buildTunnel(a: ActiveTunnel): Promise<TunnelPrepared | null> {
    dropStaleMapping();
    const lanIp = await defaultLanIp(udp);
    if (!lanIp) return null;
    const igd = igdCache?.lanIp === lanIp
        ? Promise.resolve(igdCache.igd)
        : discoverIgd(lanIp, upnpDeps).then(igd => { if (igd) igdCache = { lanIp, igd }; return igd; });
    const token = randomBytes(8);
    const ips = localIps();
    for (let i = 0; i < PORT_TRIES; i++) {
        const port = PORT_BASE + Math.floor(Math.random() * 1000);
        let t: Tunnel;
        try {
            t = await Tunnel.open({ port, proxyIp: lanIp, token }, { createSocket: udp, isLocal: ip => ips.has(ip) });
        } catch {
            continue;
        }
        const [addr, m] = await Promise.all([t.discover(), igd.then(g => PortMapping.create(g, port, lanIp, upnpDeps))]);
        if (m.status === "conflict") { t.close(); continue; }
        // другой роутер с тем же LAN-адресом (сменилась сеть) — в следующий раз ищем заново
        if (m.status === "error") igdCache = null;
        if (a.closed) {
            t.close();
            if (m.status === "ok") m.mapping.close();
            return null;
        }
        a.tunnel = t;
        if (m.status === "ok") { a.mapping = m.mapping; rememberMapping(m.mapping); }
        return { addr, token: token.toString("hex"), upnp: m.status, lanIp, proxyPort: t.proxyPort };
    }
    return null;
}

function closeActive() {
    const a = active;
    if (!a) return;
    active = null;
    a.closed = true;
    a.tunnel?.close();
    if (a.mapping) a.mapping.close().then(ok => { if (ok && !active?.mapping) rememberMapping(null); });
}
// проброс со сроком жизни истечёт и сам, но снять сразу вежливее
app.on("before-quit", closeActive);

/** Идемпотентно для одного callId; новый звонок закрывает туннель прошлого. null — туннель не поднялся */
const watched = new WeakSet<Electron.WebContents>();

export function tunnelPrepare(e: IpcMainInvokeEvent, callId: string): Promise<TunnelPrepared | null> {
    // Ctrl+R или падение рендерера: stop() плагина не выполнится, туннель и проброс закрываем сами
    if (!watched.has(e.sender)) {
        watched.add(e.sender);
        e.sender.on("did-navigate", closeActive);
        e.sender.on("render-process-gone", closeActive);
    }
    if (active?.callId === callId) return active.ready;
    closeActive();
    const a: ActiveTunnel = { callId, closed: false, ready: Promise.resolve(null) };
    a.ready = buildTunnel(a).catch(() => null);
    active = a;
    return a.ready;
}

export async function tunnelSetPeer(_: IpcMainInvokeEvent, callId: string, peer: { addr: string; token: string; }) {
    const a = active;
    if (a?.callId !== callId || !/^[0-9a-f]{16}$/.test(peer.token) || !isPeerAddr(peer.addr, localIps())) return;
    await a.ready;
    if (!a.closed) a.tunnel?.setPeer(peer.addr, Buffer.from(peer.token, "hex"));
}

export function tunnelStatus(_: IpcMainInvokeEvent, callId: string): TunnelStatus | null {
    return active?.callId === callId ? active.tunnel?.status() ?? null : null;
}

export function tunnelClose(_: IpcMainInvokeEvent, callId: string) {
    if (active?.callId === callId) closeActive();
}
