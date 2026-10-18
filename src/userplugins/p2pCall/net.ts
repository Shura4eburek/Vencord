/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Сетевая часть P2PCall отдельным бандлом dist/p2pcall-net.js: native.ts перезагружает её между звонками,
// поэтому правки туннеля и UPnP ставятся без перезапуска Discord (specs/002-update-apply-modes R3).
// Без Electron: всё, что нужно от него, приходит в createNet.

import { randomBytes } from "crypto";
import dgram from "dgram";
import { readFileSync, rmSync, writeFileSync } from "fs";
import { networkInterfaces } from "os";
import { join } from "path";

import { Tunnel, TunnelStatus } from "./tunnel";
import { isPeerAddr } from "./tunnelWire";
import { defaultLanIp, deletePortMapping, discoverIgd, httpRequest, Igd, PortMapping, UpnpDeps } from "./upnp";

export type { TunnelStatus };
/** upnpCode — код отказа роутера (SOAP errorCode, −HTTP-статус) или null: по нему видно, почему не открылся порт */
export interface TunnelPrepared { addr: string | null; token: string; upnp: "ok" | "no-igd" | "error"; upnpCode: number | null; lanIp: string; proxyPort: number; }
export interface NetEnv { userData: string; }
export interface NetApi {
    prepare(callId: string): Promise<TunnelPrepared | null>;
    setPeer(callId: string, peer: { addr: string; token: string; }): Promise<void>;
    status(callId: string): TunnelStatus | null;
    close(callId: string): void;
    closeAll(): void;
    /** Любой открытый туннель (в групповом звонке их несколько): пока он есть, модуль не перезагружается */
    activeCallId(): string | null;
    /** Перед заменой модуля новой версией */
    dispose(): void;
}
interface ActiveTunnel { callId: string; ready: Promise<TunnelPrepared | null>; tunnel?: Tunnel; mapping?: PortMapping; closed: boolean; }

const PORT_BASE = 40000;
const PORT_TRIES = 5;
const udp = () => dgram.createSocket("udp4");
const upnpDeps: UpnpDeps = { createSocket: udp, request: httpRequest };

function localIps() {
    const ips = new Set(["127.0.0.1"]);
    for (const list of Object.values(networkInterfaces())) for (const i of list ?? []) ips.add(i.address);
    return ips;
}

export function createNet(env: NetEnv): NetApi {
    // туннель на каждую связь группового звонка (specs/004-group-calls R10)
    const active = new Map<string, ActiveTunnel>();
    // описание роутера не меняется — второй звонок не ждёт SSDP
    let igdCache: { lanIp: string; igd: Igd; } | null = null;

    /**
     * Проброс, который мог остаться после падения Discord: у роутеров без срока жизни (код 725) он иначе
     * живёт до перезагрузки роутера. Запоминаем его на диске и снимаем при следующем звонке.
     */
    const staleFile = join(env.userData, "p2pcall-upnp.json");

    type Saved = { port: number; igd: Igd; };
    /** Прежний формат — один объект, теперь список (по пробросу на связь) */
    function readSaved(): Saved[] {
        try {
            const raw = JSON.parse(readFileSync(staleFile, "utf8"));
            // битые записи (обрезанный файл) отбрасываем, а не роняем ими каждый туннель
            return (Array.isArray(raw) ? raw : [raw]).filter(x => typeof x?.port === "number" && typeof x.igd?.controlUrl === "string");
        } catch {
            return [];
        }
    }

    function writeSaved(list: Saved[]) {
        try {
            if (list.length) writeFileSync(staleFile, JSON.stringify(list));
            else rmSync(staleFile, { force: true });
        } catch { }
    }

    function rememberMapping(m: PortMapping) {
        writeSaved([...readSaved().filter(x => x.port !== m.port), { port: m.port, igd: m.igd }]);
    }

    /**
     * Стираем запись, только если она про этот проброс: после замены модуля старый экземпляр снимает свой
     * проброс уже тогда, когда новый записал в тот же файл свой.
     */
    function forgetMapping(port: number, controlUrl: string) {
        writeSaved(readSaved().filter(x => !(x.port === port && x.igd?.controlUrl === controlUrl)));
    }

    /** Только при первом туннеле: пробросы идущих связей зависшими не считаются */
    function dropStaleMappings() {
        if (active.size > 1) return;
        for (const saved of readSaved()) {
            // запись стираем, только если роутер подтвердил удаление, — иначе попробуем в следующий раз
            deletePortMapping(saved.igd, saved.port, upnpDeps).then(ok => { if (ok) forgetMapping(saved.port, saved.igd.controlUrl); });
        }
    }

    async function buildTunnel(a: ActiveTunnel): Promise<TunnelPrepared | null> {
        dropStaleMappings();
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
            return { addr, token: token.toString("hex"), upnp: m.status, upnpCode: m.status === "error" ? m.code : null, lanIp, proxyPort: t.proxyPort };
        }
        return null;
    }

    function closeOne(a: ActiveTunnel) {
        if (active.get(a.callId) === a) active.delete(a.callId);
        a.closed = true;
        a.tunnel?.close();
        const m = a.mapping;
        if (m) m.close().then(ok => { if (ok) forgetMapping(m.port, m.igd.controlUrl); });
    }

    const closeAll = () => { for (const a of [...active.values()]) closeOne(a); };

    return {
        /** Идемпотентно для одного callId; туннели других связей не трогает. null — туннель не поднялся */
        prepare(callId) {
            const cur = active.get(callId);
            if (cur) return cur.ready;
            const a: ActiveTunnel = { callId, closed: false, ready: Promise.resolve(null) };
            active.set(callId, a);
            a.ready = buildTunnel(a).catch(() => null);
            return a.ready;
        },
        async setPeer(callId, peer) {
            const a = active.get(callId);
            if (!a || !/^[0-9a-f]{16}$/.test(peer.token) || !isPeerAddr(peer.addr, localIps())) return;
            await a.ready;
            if (!a.closed) a.tunnel?.setPeer(peer.addr, Buffer.from(peer.token, "hex"));
        },
        status: callId => active.get(callId)?.tunnel?.status() ?? null,
        close(callId) { const a = active.get(callId); if (a) closeOne(a); },
        closeAll,
        activeCallId: () => active.keys().next().value ?? null,
        dispose: closeAll,
    };
}
