/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

/** Файлы сборки, которые подменяет автообновление (лежат в dist рядом с patcher.js) */
export const UPDATE_FILES = ["patcher.js", "preload.js", "renderer.js", "renderer.css"] as const;
export const VERSION_FILE = "p2pcall-version.txt";
export const RELEASE_REPO = "Shura4eburek/Vencord";

export interface Manifest { version: string; files: Record<string, string>; }

const VERSION_RE = /^(\d{4})\.(\d{2})\.(\d{2})-(\d+)$/;

function parseVersion(v: string | null): [number, number] | null {
    const m = v?.match(VERSION_RE);
    return m ? [Number(m[1] + m[2] + m[3]), Number(m[4])] : null;
}

/** Версии вида YYYY.MM.DD-N. Неизвестная установленная версия — любая валидная удалённая новее */
export function isNewer(remote: string, installed: string | null): boolean {
    const r = parseVersion(remote);
    if (!r) return false;
    const i = parseVersion(installed);
    if (!i) return true;
    return r[0] !== i[0] ? r[0] > i[0] : r[1] > i[1];
}

export function nextVersion(now: Date, last: string | null): string {
    const day = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}`;
    const m = last?.match(VERSION_RE);
    const n = m && `${m[1]}.${m[2]}.${m[3]}` === day ? Number(m[4]) + 1 : 1;
    return `${day}-${n}`;
}

const HASH_RE = /^[0-9a-f]{64}$/;

/** Ровно ожидаемые файлы с sha256 — никаких лишних имён (защита от записи в чужие пути) */
export function parseManifest(raw: unknown): Manifest | null {
    if (!raw || typeof raw !== "object") return null;
    const { version, files } = raw as Manifest;
    if (typeof version !== "string" || !VERSION_RE.test(version)) return null;
    if (!files || typeof files !== "object") return null;
    const names = Object.keys(files);
    if (names.length !== UPDATE_FILES.length || !UPDATE_FILES.every(f => names.includes(f))) return null;
    if (!names.every(n => typeof files[n] === "string" && HASH_RE.test(files[n]))) return null;
    return { version, files: { ...files } };
}

export const sha256Hex = (data: Uint8Array) => bytesToHex(sha256(data));
