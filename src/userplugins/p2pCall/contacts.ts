/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Своя личность (X25519 + ID устройства) и книга контактов (specs/003-identity-keys/data-model.md).
// Без Electron: хранилище приходит снаружи, main кладёт его в userData.

import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, concatBytes, hexToBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils";

export interface Identity { deviceId: string; privateKey: Uint8Array; publicKey: Uint8Array; }

export function newIdentity(): Identity {
    const privateKey = x25519.utils.randomSecretKey();
    return { deviceId: bytesToHex(randomBytes(16)), privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

export const serializeIdentity = (id: Identity) => JSON.stringify({ deviceId: id.deviceId, privateKey: bytesToHex(id.privateKey) });

export function parseIdentity(raw: string): Identity | null {
    try {
        const { deviceId, privateKey } = JSON.parse(raw);
        if (!/^[0-9a-f]{32}$/.test(deviceId) || !/^[0-9a-f]{64}$/.test(privateKey)) return null;
        const sk = hexToBytes(privateKey);
        return { deviceId, privateKey: sk, publicKey: x25519.getPublicKey(sk) };
    } catch {
        return null;
    }
}

/** Ключ пары с одним устройством собеседника: им шифруется сигналинг (research R3) */
export function pairKey(own: Identity, peerPublicKey: Uint8Array, peerDeviceId: string): Uint8Array {
    const shared = x25519.getSharedSecret(own.privateKey, peerPublicKey);
    const salt = utf8ToBytes([own.deviceId, peerDeviceId].sort().join(":"));
    return hkdf(sha256, shared, salt, "p2pcall-v2 pair", 32);
}

export const utcDay = (now: number) => Math.floor(now / 86_400_000);

/** Тег `c` в ring контакту: меняется каждый день и ничего не говорит без ключа пары (research R7) */
export const pairHintOf = (key: Uint8Array, day: number) => bytesToHex(hmac(sha256, key, utf8ToBytes(`hint:${day}`))).slice(0, 32);

/** 8 цифр, одинаковые у обоих: сверка голосом ловит подмену ключа даже самим Discord */
export function verificationCode(a: Uint8Array, b: Uint8Array): string {
    const [lo, hi] = bytesToHex(a) < bytesToHex(b) ? [a, b] : [b, a];
    const h = sha256(concatBytes(utf8ToBytes("p2pcall-v2 code"), lo, hi));
    const n = h.subarray(0, 5).reduce((acc, x) => acc * 256 + x, 0) % 100_000_000;
    const s = String(n).padStart(8, "0");
    return `${s.slice(0, 4)} ${s.slice(4)}`;
}

/**
 * mutual — у собеседника этот ключ тоже есть (видели его сообщение на ключе пары или он завершил обмен):
 * только тогда сигналинг идёт на ключе пары, а старая схема с этим пользователем отключается
 */
export interface Device { deviceId: string; publicKey: string; addedAt: number; state: "trusted" | "pending"; verified: boolean; mutual: boolean; }
export interface Contact { userId: string; name: string; avatar: string | null; channelId: string; devices: Device[]; addedAt: number; }
export interface Store { load(): string | null; save(data: string): void; }
export type AddResult = "trusted" | "pending" | "known";

export class ContactBook {
    private contacts = new Map<string, Contact>();

    constructor(private store: Store, private now: () => number = Date.now) {
        try {
            const raw = store.load();
            for (const c of raw ? JSON.parse(raw) as Contact[] : []) this.contacts.set(c.userId, c);
        } catch { }
    }

    list(): Contact[] { return [...this.contacts.values()]; }
    get(userId: string) { return this.contacts.get(userId) ?? null; }

    /**
     * Первый ключ пользователя — доверенный; любой следующий (новое устройство, переустановка, подмена)
     * ждёт подтверждения (FR-005)
     */
    addDevice(userId: string, d: { deviceId: string; publicKey: string; channelId: string; name?: string; avatar?: string | null; mutual?: boolean; }): AddResult {
        const at = this.now();
        let c = this.contacts.get(userId);
        if (!c) {
            c = { userId, name: d.name ?? userId, avatar: d.avatar ?? null, channelId: d.channelId, devices: [], addedAt: at };
            this.contacts.set(userId, c);
        }
        const known = c.devices.find(x => x.publicKey === d.publicKey);
        if (known) {
            if (d.mutual) this.markMutual(userId, d.publicKey);
            return "known";
        }
        const state = c.devices.length ? "pending" : "trusted";
        c.devices.push({ deviceId: d.deviceId, publicKey: d.publicKey, addedAt: at, state, verified: false, mutual: !!d.mutual });
        this.save();
        return state;
    }

    confirm(userId: string, publicKey: string) {
        const d = this.device(userId, publicKey);
        if (d && d.state !== "trusted") { d.state = "trusted"; this.save(); }
    }

    markMutual(userId: string, publicKey: string) {
        const d = this.device(userId, publicKey);
        if (d && !d.mutual) { d.mutual = true; this.save(); }
    }

    setVerified(userId: string, publicKey: string, verified: boolean) {
        const d = this.device(userId, publicKey);
        if (d && d.verified !== verified) { d.verified = verified; this.save(); }
    }

    /** Без publicKey — весь контакт */
    remove(userId: string, publicKey?: string) {
        const c = this.contacts.get(userId);
        if (!c) return;
        if (publicKey) c.devices = c.devices.filter(d => d.publicKey !== publicKey);
        if (!publicKey || !c.devices.length) this.contacts.delete(userId);
        this.save();
    }

    updateProfile(userId: string, name: string, avatar: string | null) {
        const c = this.contacts.get(userId);
        if (!c || (c.name === name && c.avatar === avatar)) return;
        c.name = name;
        c.avatar = avatar;
        this.save();
    }

    private device(userId: string, publicKey: string) {
        return this.contacts.get(userId)?.devices.find(d => d.publicKey === publicKey) ?? null;
    }

    private save() {
        this.store.save(JSON.stringify(this.list()));
    }
}
