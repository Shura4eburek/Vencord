/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// CPace (draft-irtf-cfrg-cpace-15), набор CPACE-RISTR255-SHA512, режим инициатор/ответчик.
// Обмен ключами по слабому паролю: сообщения — случайные точки группы, по ним пароль не проверить офлайн
// (specs/003-identity-keys/research.md R2). Проверено векторами приложения B.3 драфта.

import { ristretto255, ristretto255_hasher } from "@noble/curves/ed25519.js";
import { sha512 } from "@noble/hashes/sha2";
import { concatBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils";

const { Point } = ristretto255;
const DSI = utf8ToBytes("CPaceRistretto255");
const DSI_ISK = utf8ToBytes("CPaceRistretto255_ISK");
/** Размер входного блока SHA-512 */
const S_IN_BYTES = 128;

/** prepend_len: длина в LEB128 + сами байты */
function prependLen(data: Uint8Array): Uint8Array {
    const len: number[] = [];
    let n = data.length;
    do {
        let b = n & 0x7f;
        n >>>= 7;
        if (n) b |= 0x80;
        len.push(b);
    } while (n);
    return concatBytes(Uint8Array.from(len), data);
}

export const lvCat = (...parts: Uint8Array[]) => concatBytes(...parts.map(prependLen));

export function generatorString(prs: Uint8Array, ci: Uint8Array, sid: Uint8Array): Uint8Array {
    const zpad = Math.max(0, S_IN_BYTES - 1 - prependLen(prs).length - prependLen(DSI).length);
    return lvCat(DSI, prs, new Uint8Array(zpad), ci, sid);
}

export function calculateGenerator(prs: Uint8Array, ci: Uint8Array, sid: Uint8Array) {
    return ristretto255_hasher.deriveToCurve!(sha512(generatorString(prs, ci, sid)));
}

const scalarFromLE = (bytes: Uint8Array) => Point.Fn.create(bytes.reduceRight((acc, b) => (acc << 8n) | BigInt(b), 0n));

/** sample_scalar по рекомендации драфта: 32 случайных байта, биты старше 252-го обнулены */
export function sampleScalar(): bigint {
    for (; ;) {
        const b = randomBytes(32);
        b[31] &= 0x0f;
        const y = scalarFromLE(b);
        if (y !== 0n) return y;
    }
}

export interface CpaceShare { y: bigint; Y: Uint8Array; }

/** Своё сообщение: Y = encode(y·g). yLE — только для тестовых векторов */
export function start(prs: Uint8Array, ci: Uint8Array, sid: Uint8Array, yLE?: Uint8Array): CpaceShare {
    const y = yLE ? scalarFromLE(yLE) : sampleScalar();
    return { y, Y: calculateGenerator(prs, ci, sid).multiply(y).toBytes() };
}

/** scalar_mult_vfy: null вместо G.I — неверная кодировка или нейтральный элемент, обмен прерывается */
export function scalarMultVfy(y: bigint, X: Uint8Array): Uint8Array | null {
    let P;
    try {
        P = Point.fromBytes(X);
    } catch {
        return null;
    }
    if (P.is0()) return null;
    const K = P.multiply(y);
    return K.is0() ? null : K.toBytes();
}

export const transcriptIr = (Ya: Uint8Array, ADa: Uint8Array, Yb: Uint8Array, ADb: Uint8Array) =>
    concatBytes(lvCat(Ya, ADa), lvCat(Yb, ADb));

/** ISK = H(lv_cat(DSI_ISK, sid, K) ‖ transcript); null — сообщение собеседника отвергнуто */
export function finish(y: bigint, Ypeer: Uint8Array, sid: Uint8Array, transcript: Uint8Array): Uint8Array | null {
    const K = scalarMultVfy(y, Ypeer);
    return K && sha512(concatBytes(lvCat(DSI_ISK, sid, K), transcript));
}
