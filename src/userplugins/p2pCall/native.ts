/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ConnectSrc, CspPolicies } from "@main/csp";
import { RendererSettings } from "@main/settings";
import { bytesToHex } from "@noble/hashes/utils";
import { app, desktopCapturer, IpcMainInvokeEvent, safeStorage } from "electron";
import { existsSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

import { Contact, ContactBook, Device, Identity, newIdentity, pairKey, parseIdentity, serializeIdentity, verificationCode } from "./contacts";
import type { TunnelPrepared, TunnelStatus } from "./net";
import { NetLoader } from "./netLoader";
import { HandleResult, Pairing, PakeMsg, PeerInfo } from "./pairing";
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

// ── Ключи и контакты (specs/003-identity-keys, research R4) ──
// Приватный ключ не покидает main: рендерер получает только ключи пар.

const IDENTITY_FILE = "p2pcall-identity.bin";
const PLAIN = "plain:";
const userFile = (name: string) => join(app.getPath("userData"), name);

/** Запись через временный файл: падение Discord посреди записи не оставит обрезанный файл */
function writeAtomic(path: string, data: string | Buffer) {
    writeFileSync(path + ".tmp", data);
    renameSync(path + ".tmp", path);
}

/**
 * Ключ под safeStorage (DPAPI): другой пользователь Windows его не прочитает. Нет DPAPI — без шифрования.
 * Файл есть, но не читается (сбой DPAPI, миграция профиля) — ключ НЕ меняем: бросаем, и в эту сессию звонки
 * идут без ключей; новый ключ сделал бы всех контактов «подменёнными», а старый был бы потерян.
 */
function loadIdentity(): Identity {
    const path = userFile(IDENTITY_FILE);
    if (existsSync(path)) {
        const buf = readFileSync(path);
        const raw = buf.subarray(0, PLAIN.length).toString("latin1") === PLAIN ? buf.subarray(PLAIN.length).toString("utf8") : safeStorage.decryptString(buf);
        const id = parseIdentity(raw);
        if (!id) throw new Error("p2pcall-identity.bin не читается — ключ не изменён");
        return id;
    }
    const id = newIdentity();
    const raw = serializeIdentity(id);
    if (safeStorage.isEncryptionAvailable()) writeAtomic(path, safeStorage.encryptString(raw));
    else {
        console.warn("[P2PCall] safeStorage недоступен — ключ хранится без шифрования");
        writeAtomic(path, PLAIN + raw);
    }
    return id;
}

interface Keys { selfId: string; id: Identity; book: ContactBook; pairing: Pairing; }
let keys: Keys | null = null;

/** Контакты — свои у каждого аккаунта Discord; личность установки общая */
export function pairingInit(_: IpcMainInvokeEvent, selfId: string) {
    if (keys?.selfId === selfId) return;
    const id = keys?.id ?? loadIdentity();
    const file = userFile(`p2pcall-contacts-${selfId}.json`);
    const book = new ContactBook({
        load: () => {
            if (!existsSync(file)) return null;
            const raw = readFileSync(file, "utf8");
            // битый файл не затираем молча: копия остаётся, чтобы контакты можно было восстановить
            try { JSON.parse(raw); } catch { renameSync(file, `${file}.corrupt-${Date.now()}`); return null; }
            return raw;
        },
        save: data => writeAtomic(file, data),
    });
    keys = { selfId, id, book, pairing: new Pairing(selfId, id, book) };
}

const NONE: HandleResult = { send: [], added: null };

export function pairingStart(_: IpcMainInvokeEvent, peerId: string, peer: PeerInfo, force = false): PakeMsg | null {
    return keys?.pairing.start(peerId, peer, force) ?? null;
}

export function pairingHandle(_: IpcMainInvokeEvent, msg: PakeMsg, peer: PeerInfo | null): HandleResult {
    return keys?.pairing.handle(msg, peer) ?? NONE;
}

export interface PairKeyWire { userId: string; deviceId: string; channelId: string; key: string; mutual: boolean; }

/** Только доверенные устройства: pending (новое устройство или подмена) ключа пары не получает */
export function pairKeys(_: IpcMainInvokeEvent): PairKeyWire[] {
    if (!keys) return [];
    const { id, book } = keys;
    // каждое устройство отдельно: один негодный ключ в файле не должен лишить ключей всех контактов
    return book.list().flatMap(c => c.devices.filter(d => d.state === "trusted").flatMap(d => {
        try {
            const key = bytesToHex(pairKey(id, Uint8Array.from(Buffer.from(d.publicKey, "hex")), d.deviceId));
            return [{ userId: c.userId, deviceId: d.deviceId, channelId: c.channelId, mutual: d.mutual, key }];
        } catch {
            return [];
        }
    }));
}

export type ContactView = Omit<Contact, "devices"> & { devices: (Device & { code: string; })[]; };

export function contactsList(_: IpcMainInvokeEvent): ContactView[] {
    if (!keys) return [];
    const own = keys.id.publicKey;
    return keys.book.list().map(c => ({
        ...c,
        devices: c.devices.map(d => ({ ...d, code: verificationCode(own, Uint8Array.from(Buffer.from(d.publicKey, "hex"))) })),
    }));
}

export function contactConfirm(_: IpcMainInvokeEvent, userId: string, publicKey: string) { keys?.book.confirm(userId, publicKey); }
export function contactVerify(_: IpcMainInvokeEvent, userId: string, publicKey: string, verified: boolean) { keys?.book.setVerified(userId, publicKey, verified); }
export function contactRemove(_: IpcMainInvokeEvent, userId: string, publicKey?: string) { keys?.book.remove(userId, publicKey); }
export function contactProfile(_: IpcMainInvokeEvent, userId: string, name: string, avatar: string | null) { keys?.book.updateProfile(userId, name, avatar); }

export function contactMutual(_: IpcMainInvokeEvent, userId: string, deviceId: string) {
    const d = keys?.book.get(userId)?.devices.find(x => x.deviceId === deviceId && x.state === "trusted");
    if (d) keys!.book.markMutual(userId, d.publicKey);
}
