/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Формат пакетов UDP-туннеля (specs/001-udp-tunnel-upnp/contracts/tunnel.md §3–4)

export const MAGIC = "P2T1";
export const HEADER_LEN = 14;
export const TOKEN_LEN = 8;
export const KIND_DATA = 0;
export const KIND_KEEPALIVE = 1;
/** 0 — отправлено на публичный адрес получателя, 1 — на адрес, с которого он реально приходит */
export type PathId = 0 | 1;
export type FrameKind = typeof KIND_DATA | typeof KIND_KEEPALIVE;

export interface Frame { token: Buffer; path: PathId; kind: FrameKind; payload: Buffer; }

export function header(token: Buffer, path: PathId, kind: FrameKind): Buffer {
    const h = Buffer.allocUnsafe(HEADER_LEN);
    h.write(MAGIC, 0, "latin1");
    token.copy(h, 4, 0, TOKEN_LEN);
    h[12] = path;
    h[13] = kind;
    return h;
}

/** null — не наш пакет: короткий, без magic или с неизвестными path/kind */
export function decode(buf: Buffer): Frame | null {
    if (buf.length < HEADER_LEN || buf.toString("latin1", 0, 4) !== MAGIC) return null;
    const path = buf[12], kind = buf[13];
    if (path > 1 || kind > 1) return null;
    return { token: buf.subarray(4, 12), path: path as PathId, kind: kind as FrameKind, payload: buf.subarray(HEADER_LEN) };
}

/** Тело keepalive — битовая маска path, по которым отправитель получает пакеты */
export const keepaliveBody = (mask: number) => Buffer.from([mask & 3]);
export const keepaliveMask = (payload: Buffer) => payload.length ? payload[0] & 3 : 0;

export type PacketClass = "stun" | "dtls" | "rtp" | "other";

/** RFC 7983: что лежит в UDP-датаграмме WebRTC — по первому байту */
export function classify(b: Uint8Array): PacketClass {
    if (!b.length) return "other";
    const x = b[0];
    if (x <= 3) return "stun";
    if (x >= 20 && x <= 63) return "dtls";
    if (x >= 128 && x <= 191) return "rtp";
    return "other";
}

/** Приоритет уровня relay-кандидата (type preference 0): обычный путь ICE всегда важнее */
export const TUNNEL_PRIORITY = (0 << 24) + (65535 << 8) + 255;

export function tunnelCandidate(ip: string, port: number): RTCIceCandidateInit {
    return { candidate: `candidate:p2ptun 1 udp ${TUNNEL_PRIORITY} ${ip} ${port} typ host generation 0`, sdpMid: "0", sdpMLineIndex: 0 };
}

/** Адрес туннеля собеседника — публичный IPv4 по STUN; свои, loopback и LAN-адреса не принимаем */
export function isPeerAddr(addr: string, own: Set<string>) {
    const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}:\d{1,5}$/.exec(addr);
    if (!m) return false;
    const [a, b] = [Number(m[1]), Number(m[2])];
    const priv = a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    return !priv && !own.has(addr.slice(0, addr.lastIndexOf(":")));
}
