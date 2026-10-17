/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Минимальный UPnP IGD: открыть UDP-порт туннеля на домашнем роутере на время звонка
// (specs/001-udp-tunnel-upnp/research.md R4). Без Electron и без зависимостей.

import type { Socket } from "dgram";
import http from "http";

export interface HttpResponse { status: number; body: string; }
export interface HttpInit { method: "GET" | "POST"; headers?: Record<string, string>; body?: string; timeoutMs: number; }
export interface UpnpDeps {
    createSocket(): Socket;
    request(url: string, init: HttpInit): Promise<HttpResponse>;
}
export interface Igd { controlUrl: string; service: string; }

const SSDP_ADDR = "239.255.255.250";
const SSDP_PORT = 1900;
const ST = "urn:schemas-upnp-org:device:InternetGatewayDevice:1";
const SERVICES = [
    "urn:schemas-upnp-org:service:WANIPConnection:2",
    "urn:schemas-upnp-org:service:WANIPConnection:1",
    "urn:schemas-upnp-org:service:WANPPPConnection:1",
];
export const DESCRIPTION = "P2PCall";
export const LEASE_SEC = 600;
const RENEW_MS = 5 * 60_000;
const ERR_CONFLICT = 718;
const ERR_NO_SUCH_ENTRY = 714;

export function parseSsdpLocation(msg: string): string | null {
    return msg.match(/^location:\s*(\S+)/im)?.[1] ?? null;
}

/** Сервис подключения к WAN из описания устройства; относительный controlURL — от URLBase или LOCATION */
export function parseIgd(xml: string, location: string): Igd | null {
    const base = xml.match(/<URLBase>\s*([^<\s]+)\s*<\/URLBase>/i)?.[1] ?? location;
    const blocks = [...xml.matchAll(/<service>([\s\S]*?)<\/service>/gi)].map(m => m[1]);
    for (const service of SERVICES) {
        for (const b of blocks) {
            if (b.match(/<serviceType>\s*([^<\s]+)\s*<\/serviceType>/i)?.[1] !== service) continue;
            const ctl = b.match(/<controlURL>\s*([^<\s]+)\s*<\/controlURL>/i)?.[1];
            if (!ctl) continue;
            try { return { controlUrl: new URL(ctl, base).href, service }; } catch { return null; }
        }
    }
    return null;
}

export function soapEnvelope(service: string, action: string, args: [string, string | number][]): string {
    const body = args.map(([k, v]) => `<${k}>${v}</${k}>`).join("");
    return `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${service}">${body}</u:${action}></s:Body></s:Envelope>`;
}

export function soapErrorCode(body: string): number | null {
    const m = body.match(/<errorCode>\s*(\d+)\s*<\/errorCode>/i);
    return m ? Number(m[1]) : null;
}

/** LAN-адрес маршрута по умолчанию: connect не шлёт пакетов, только выбирает интерфейс */
export function defaultLanIp(createSocket: () => Socket): Promise<string | null> {
    return new Promise(resolve => {
        const s = createSocket();
        s.on("error", () => { s.close(); resolve(null); });
        s.connect(53, "8.8.8.8", () => {
            const ip = s.address().address;
            s.close();
            resolve(ip && ip !== "0.0.0.0" ? ip : null);
        });
    });
}

/**
 * SSDP M-SEARCH с сокета на LAN-адресе: при нескольких адаптерах (Radmin, Hamachi, Hyper-V) без привязки
 * ответ роутера не приходит (замер 17.10). Первый ответ с рабочим описанием IGD — наш.
 */
export function discoverIgd(lanIp: string, d: UpnpDeps, timeoutMs = 1500, target: [string, number] = [SSDP_ADDR, SSDP_PORT]): Promise<Igd | null> {
    return new Promise(resolve => {
        const s = d.createSocket();
        let done = false, expired = false, pending = 0;
        const finish = (igd: Igd | null) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try { s.close(); } catch { }
            resolve(igd);
        };
        // описание, которое уже качается, дождёмся и после таймаута
        const timer = setTimeout(() => { expired = true; if (!pending) finish(null); }, timeoutMs);
        const seen = new Set<string>();
        s.on("error", () => finish(null));
        s.on("message", m => {
            const loc = parseSsdpLocation(m.toString("latin1"));
            if (!loc || seen.has(loc)) return;
            seen.add(loc);
            pending++;
            d.request(loc, { method: "GET", timeoutMs: 1500 })
                .then(r => { const igd = r.status === 200 ? parseIgd(r.body, loc) : null; if (igd) finish(igd); })
                .catch(() => { })
                .finally(() => { if (!--pending && expired) finish(null); });
        });
        const msg = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_ADDR}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: ${ST}\r\n\r\n`);
        s.bind(0, lanIp, () => {
            s.send(msg, target[1], target[0]);
            setTimeout(() => { if (!done) s.send(msg, target[1], target[0]); }, 300);
        });
    });
}

async function soap(igd: Igd, action: string, args: [string, string | number][], d: UpnpDeps): Promise<number | null> {
    const r = await d.request(igd.controlUrl, {
        method: "POST",
        headers: { "Content-Type": 'text/xml; charset="utf-8"', SOAPAction: `"${igd.service}#${action}"` },
        body: soapEnvelope(igd.service, action, args),
        timeoutMs: 2000,
    });
    if (r.status === 200) return null;
    return soapErrorCode(r.body) ?? -r.status;
}

export type MapResult = { ok: true; lease: number; } | { ok: false; code: number | null; };

/**
 * Порт снаружи = порт внутри. Отказ со сроком жизни (725 OnlyPermanentLeasesSupported, а у части роутеров
 * 402/501 на тот же случай) — повтор с постоянным пробросом, его снимаем сами. Конфликт порта — не повторяем.
 */
export async function addPortMapping(igd: Igd, port: number, lanIp: string, d: UpnpDeps, lease = LEASE_SEC): Promise<MapResult> {
    const args = (l: number): [string, string | number][] => [
        ["NewRemoteHost", ""], ["NewExternalPort", port], ["NewProtocol", "UDP"], ["NewInternalPort", port],
        ["NewInternalClient", lanIp], ["NewEnabled", 1], ["NewPortMappingDescription", DESCRIPTION], ["NewLeaseDuration", l],
    ];
    try {
        let code = await soap(igd, "AddPortMapping", args(lease), d);
        if (code !== null && code !== ERR_CONFLICT && lease) {
            lease = 0;
            code = await soap(igd, "AddPortMapping", args(0), d);
        }
        return code === null ? { ok: true, lease } : { ok: false, code };
    } catch {
        return { ok: false, code: null };
    }
}

/** true — проброса на роутере больше нет (714 NoSuchEntryInArray — его уже не было) */
export async function deletePortMapping(igd: Igd, port: number, d: UpnpDeps): Promise<boolean> {
    try {
        const code = await soap(igd, "DeletePortMapping", [["NewRemoteHost", ""], ["NewExternalPort", port], ["NewProtocol", "UDP"]], d);
        return code === null || code === ERR_NO_SUCH_ENTRY;
    } catch {
        return false;
    }
}

export type MappingResult =
    | { status: "ok"; mapping: PortMapping; }
    | { status: "conflict"; }
    | { status: "no-igd"; }
    | { status: "error"; code: number | null; };

/** Проброс на время звонка: продлевается, пока жив, снимается в close() */
export class PortMapping {
    private timer: ReturnType<typeof setInterval> | undefined;

    private constructor(readonly igd: Igd, readonly port: number, private lanIp: string, readonly lease: number, private d: UpnpDeps) {
        if (lease) this.timer = setInterval(() => { addPortMapping(igd, port, lanIp, d, lease); }, RENEW_MS);
    }

    static async create(igd: Igd | null, port: number, lanIp: string, d: UpnpDeps): Promise<MappingResult> {
        if (!igd) return { status: "no-igd" };
        const r = await addPortMapping(igd, port, lanIp, d);
        if (r.ok) return { status: "ok", mapping: new PortMapping(igd, port, lanIp, r.lease, d) };
        return r.code === ERR_CONFLICT ? { status: "conflict" } : { status: "error", code: r.code };
    }

    close(): Promise<boolean> {
        clearInterval(this.timer);
        return deletePortMapping(this.igd, this.port, this.d);
    }
}

export function httpRequest(url: string, init: HttpInit): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
        const req = http.request(url, { method: init.method, headers: init.headers, timeout: init.timeoutMs }, res => {
            const chunks: Buffer[] = [];
            res.on("data", c => chunks.push(c));
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
            res.on("error", reject);
        });
        req.on("timeout", () => req.destroy(new Error("timeout")));
        req.on("error", reject);
        if (init.body) req.write(init.body);
        req.end();
    });
}
