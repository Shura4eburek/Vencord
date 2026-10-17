/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// UDP-туннель для собеседников за общим CGNAT (specs/001-udp-tunnel-upnp/research.md R1–R3, R5).
// WebRTC шлёт на прокси-сокет как будто собеседнику, туннельный сокет пересылает это собеседнику.
// Без Electron: сокеты приходят через deps, чтобы тестироваться под голым Node.

import { randomBytes } from "crypto";
import type { RemoteInfo, Socket } from "dgram";

import { classify, decode, header, keepaliveBody, keepaliveMask, KIND_DATA, KIND_KEEPALIVE, PathId } from "./tunnelWire";

export interface TunnelDeps {
    createSocket(): Socket;
    /** Источники прокси — только адреса этого ПК: чужие пакеты в звонок не пускаем */
    isLocal(ip: string): boolean;
    stunServers?: [string, number][];
    now?(): number;
}

export interface TunnelOptions {
    port: number;
    /** Адрес, на котором WebRTC увидит прокси (LAN-адрес маршрута по умолчанию) */
    proxyIp: string;
    token: Buffer;
    bindIp?: string;
    keepaliveMs?: number;
}

export interface TunnelStatus {
    port: number; proxyIp: string; proxyPort: number; publicAddr: string | null;
    peer: { public: string; observed: string | null; confirmedPaths: number; rxPaths: number; rxAgoMs: number | null; } | null;
    rx: number; tx: number; dropped: number;
}

export const DEFAULT_STUN: [string, number][] = [["stun.l.google.com", 19302], ["stun.cloudflare.com", 3478]];
const SOURCE_TTL_MS = 30_000;
/** Путь «работает», если по нему что-то пришло за это время: keepalive идут раз в 2 с */
const PATH_ALIVE_MS = 6_000;
const STUN_COOKIE = 0x2112a442;

interface Addr { address: string; port: number; }
interface Source extends Addr { lastSeen: number; }
interface Peer {
    addrs: [Addr, Addr | null];
    token: Buffer;
    confirmed: number;
    rxAt: [number | null, number | null];
    lastRx: number | null;
}

const key = (a: Addr) => `${a.address}:${a.port}`;
const same = (a: Addr | null, b: Addr) => !!a && a.address === b.address && a.port === b.port;

export function parseAddr(s: string): Addr | null {
    const i = s.lastIndexOf(":");
    const port = Number(s.slice(i + 1));
    if (i <= 0 || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
    return { address: s.slice(0, i), port };
}

function bind(sock: Socket, port: number, ip: string) {
    return new Promise<void>((resolve, reject) => {
        sock.once("error", reject);
        sock.bind(port, ip, () => { sock.off("error", reject); resolve(); });
    });
}

/** XOR-MAPPED-ADDRESS из Binding success response, иначе null */
export function parseStunResponse(msg: Buffer, tid: Buffer): Addr | null {
    if (msg.length < 20 || msg.readUInt16BE(0) !== 0x0101 || msg.readUInt32BE(4) !== STUN_COOKIE || !msg.subarray(8, 20).equals(tid)) return null;
    let i = 20;
    while (i + 4 <= msg.length) {
        const type = msg.readUInt16BE(i), len = msg.readUInt16BE(i + 2);
        if (type === 0x0020 && len >= 8 && msg[i + 5] === 1) {
            const port = msg.readUInt16BE(i + 6) ^ (STUN_COOKIE >>> 16);
            const ip = [0, 1, 2, 3].map(k => msg[i + 8 + k] ^ ((STUN_COOKIE >>> (24 - 8 * k)) & 0xff)).join(".");
            return { address: ip, port };
        }
        i += 4 + len + ((4 - (len % 4)) % 4);
    }
    return null;
}

export class Tunnel {
    publicAddr: string | null = null;
    private peer: Peer | null = null;
    private sources = new Map<string, Source>();
    private media: Source | null = null;
    private stunTid: Buffer | null = null;
    private onStun: ((a: Addr) => void) | null = null;
    private timer: ReturnType<typeof setInterval>;
    private ticks = 0;
    private rx = 0;
    private tx = 0;
    private dropped = 0;
    private closed = false;
    private now: () => number;

    private constructor(private o: TunnelOptions, private d: TunnelDeps, private tun: Socket, private proxy: Socket) {
        this.now = d.now ?? Date.now;
        tun.on("message", (m, r) => this.onTunnel(m, r));
        proxy.on("message", (m, r) => this.onProxy(m, r));
        // ошибки отправки (сеть пропала) не должны ронять main-процесс Discord
        tun.on("error", () => { });
        proxy.on("error", () => { });
        this.timer = setInterval(() => this.tick(), o.keepaliveMs ?? 1000);
    }

    /** Бросает EADDRINUSE, если порт занят, — вызывающий берёт другой */
    static async open(o: TunnelOptions, d: TunnelDeps): Promise<Tunnel> {
        const tun = d.createSocket(), proxy = d.createSocket();
        try {
            await bind(tun, o.port, o.bindIp ?? "0.0.0.0");
            await bind(proxy, 0, o.proxyIp);
        } catch (e) {
            tun.close(); proxy.close();
            throw e;
        }
        return new Tunnel(o, d, tun, proxy);
    }

    get proxyPort() { return this.proxy.address().port; }

    /** Публичный адрес туннельного сокета по STUN — первый ответивший сервер */
    discover(timeoutMs = 2000): Promise<string | null> {
        const servers = this.d.stunServers ?? DEFAULT_STUN;
        if (!servers.length) return Promise.resolve(null);
        const tid = this.stunTid = randomBytes(12);
        const req = Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(4), tid]);
        req.writeUInt32BE(STUN_COOKIE, 4);
        return new Promise(resolve => {
            const t = setTimeout(() => { this.onStun = null; resolve(null); }, timeoutMs);
            this.onStun = a => {
                clearTimeout(t);
                this.onStun = null;
                this.publicAddr = key(a);
                resolve(this.publicAddr);
            };
            for (const [host, port] of servers) this.tun.send(req, port, host);
        });
    }

    setPeer(addr: string, token: Buffer) {
        const pub = parseAddr(addr);
        if (!pub || this.closed) return;
        this.peer = { addrs: [pub, null], token: Buffer.from(token), confirmed: 0, rxAt: [null, null], lastRx: null };
        this.keepalive();
    }

    status(): TunnelStatus {
        const p = this.peer;
        return {
            port: this.o.port, proxyIp: this.o.proxyIp, proxyPort: this.proxyPort, publicAddr: this.publicAddr,
            peer: p && {
                public: key(p.addrs[0]), observed: p.addrs[1] && key(p.addrs[1]),
                confirmedPaths: p.confirmed, rxPaths: this.rxMask(p), rxAgoMs: p.lastRx === null ? null : this.now() - p.lastRx,
            },
            rx: this.rx, tx: this.tx, dropped: this.dropped,
        };
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        clearInterval(this.timer);
        this.peer = null;
        this.tun.close();
        this.proxy.close();
    }

    private onTunnel(m: Buffer, r: RemoteInfo) {
        if (this.onStun && this.stunTid) {
            const a = parseStunResponse(m, this.stunTid);
            if (a) { this.onStun(a); return; }
        }
        const f = decode(m);
        const p = this.peer;
        if (!f || !p || !f.token.equals(p.token)) { this.dropped++; return; }
        this.rx++;
        const first = p.lastRx === null;
        p.lastRx = this.now();
        p.rxAt[f.path] = p.lastRx;
        // несимметричный маршрут: собеседник приходит не с того адреса, что объявил
        if (!same(p.addrs[0], r) && !same(p.addrs[1], r)) p.addrs[1] = { address: r.address, port: r.port };
        if (first) this.keepalive();
        if (f.kind === KIND_KEEPALIVE) { p.confirmed = keepaliveMask(f.payload); return; }
        this.deliver(f.payload);
    }

    private onProxy(m: Buffer, r: RemoteInfo) {
        if (!this.d.isLocal(r.address)) { this.dropped++; return; }
        const k = key(r);
        let s = this.sources.get(k);
        if (!s) { s = { address: r.address, port: r.port, lastSeen: 0 }; this.sources.set(k, s); }
        s.lastSeen = this.now();
        if (classify(m) !== "stun") this.media = s;
        const p = this.peer;
        if (!p) return;
        for (const path of this.dataPaths(p)) this.send(p, path, KIND_DATA, m);
    }

    /** Скользящая маска: путь, переставший работать посреди звонка, выпадает, и отправитель уходит с него */
    private rxMask(p: Peer) {
        const now = this.now();
        return p.rxAt.reduce<number>((m, at, i) => at !== null && now - at < PATH_ALIVE_MS ? m | (1 << i) : m, 0);
    }

    /** Данные — по одному подтверждённому собеседником пути (публичный важнее); пока подтверждений нет — по всем */
    private dataPaths(p: Peer): PathId[] {
        const known: PathId[] = p.addrs[1] ? [0, 1] : [0];
        const ok = known.find(i => p.confirmed & (1 << i));
        return ok === undefined ? known : [ok];
    }

    /** STUN — всем живым источникам (ответ сам найдёт свой сокет по transaction id), медиа — одному */
    private deliver(payload: Buffer) {
        const now = this.now();
        for (const [k, s] of this.sources) if (now - s.lastSeen > SOURCE_TTL_MS) this.sources.delete(k);
        if (this.media && !this.sources.has(key(this.media))) this.media = null;
        const targets = classify(payload) !== "stun" && this.media ? [this.media] : [...this.sources.values()];
        for (const t of targets) this.proxy.send(payload, t.port, t.address);
    }

    private send(p: Peer, path: PathId, kind: typeof KIND_DATA | typeof KIND_KEEPALIVE, body: Buffer) {
        const to = p.addrs[path];
        if (!to) return;
        this.tx++;
        this.tun.send([header(this.o.token, path, kind), body], to.port, to.address);
    }

    /** До первого ответа — каждый тик, потом через тик: держим маппинги NAT */
    private tick() {
        if (this.peer?.lastRx !== null && this.ticks++ % 2) return;
        this.keepalive();
    }

    private keepalive() {
        const p = this.peer;
        if (!p) return;
        const body = keepaliveBody(this.rxMask(p));
        this.send(p, 0, KIND_KEEPALIVE, body);
        this.send(p, 1, KIND_KEEPALIVE, body);
    }
}
