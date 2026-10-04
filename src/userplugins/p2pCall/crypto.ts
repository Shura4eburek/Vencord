/*
 * P2PCall — темы, ключи и шифрование сигналинга
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, randomBytes, utf8ToBytes } from "@noble/hashes/utils";

const V = "p2pcall-v1";

const hashHex = (s: string) => bytesToHex(sha256(utf8ToBytes(s)));

export const topicLine = (userId: string) => hashHex(`${V}:line:${userId}`);
export const topicCall = (callId: string) => hashHex(`${V}:call:${callId}`);
export const pairHint = (channelId: string) => hashHex(`${V}:pair:${channelId}`);

export function deriveKey(channelId: string, uidA: string, uidB: string): Uint8Array {
    const [lo, hi] = BigInt(uidA) < BigInt(uidB) ? [uidA, uidB] : [uidB, uidA];
    return hkdf(sha256, utf8ToBytes(`${channelId}:${lo}:${hi}`), undefined, V, 32);
}

function toB64(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
}

function fromB64(s: string): Uint8Array {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

export function seal(key: Uint8Array, data: unknown): string {
    const nonce = randomBytes(24);
    const ct = xchacha20poly1305(key, nonce).encrypt(utf8ToBytes(JSON.stringify(data)));
    const out = new Uint8Array(24 + ct.length);
    out.set(nonce);
    out.set(ct, 24);
    return toB64(out);
}

export function open(key: Uint8Array, sealed: string): unknown | null {
    try {
        const buf = fromB64(sealed);
        if (buf.length <= 24) return null;
        const pt = xchacha20poly1305(key, buf.subarray(0, 24)).decrypt(buf.subarray(24));
        return JSON.parse(new TextDecoder().decode(pt));
    } catch {
        return null;
    }
}

export const newCallId = () => bytesToHex(randomBytes(16));
export const newMsgId = () => bytesToHex(randomBytes(8));
