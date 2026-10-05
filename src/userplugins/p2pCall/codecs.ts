/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type VideoCodec = "video/AV1" | "video/H264" | "video/VP9";
export type CodecChoice = "auto" | VideoCodec;
export interface Caps { encodeHw: string[]; decodeHw: string[]; }

export const CODEC_ORDER: readonly VideoCodec[] = ["video/AV1", "video/H264", "video/VP9"];
export const FALLBACK_CODEC: VideoCodec = "video/H264";
export const EMPTY_CAPS: Caps = { encodeHw: [], decodeHw: [] };

/** Кодек для своей отправки: аппаратный у нас на кодирование и у собеседника на декодирование */
export function chooseCodec(manual: CodecChoice, own: Caps | null, peer: Caps | null): VideoCodec {
    if (manual !== "auto") return manual;
    if (!own || !peer) return FALLBACK_CODEC;
    return CODEC_ORDER.find(c => own.encodeHw.includes(c) && peer.decodeHw.includes(c)) ?? FALLBACK_CODEC;
}

/** Все записи выбранного кодека (у H.264 их несколько — профили) вперёд, остальные в прежнем порядке */
export function orderCodecs<T extends { mimeType: string; }>(codecs: T[], first: string): T[] {
    return [...codecs.filter(c => c.mimeType === first), ...codecs.filter(c => c.mimeType !== first)];
}

const PROBE = { width: 1920, height: 1080, bitrate: 20_000_000, framerate: 60 };

export async function probeCaps(mc: Pick<MediaCapabilities, "encodingInfo" | "decodingInfo"> | undefined = globalThis.navigator?.mediaCapabilities): Promise<Caps> {
    if (!mc) return { encodeHw: [], decodeHw: [] };
    const check = async (fn: () => Promise<MediaCapabilitiesInfo>) => {
        try {
            const r = await fn();
            return r.supported && r.powerEfficient;
        } catch {
            return false;
        }
    };
    const encodeHw: string[] = [];
    const decodeHw: string[] = [];
    for (const contentType of CODEC_ORDER) {
        const video = { contentType, ...PROBE };
        if (await check(() => mc.encodingInfo({ type: "webrtc", video } as MediaEncodingConfiguration))) encodeHw.push(contentType);
        if (await check(() => mc.decodingInfo({ type: "webrtc", video } as MediaDecodingConfiguration))) decodeHw.push(contentType);
    }
    return { encodeHw, decodeHw };
}

export function isCaps(v: unknown): v is Caps {
    if (!v || typeof v !== "object") return false;
    const c = v as Caps;
    return Array.isArray(c.encodeHw) && Array.isArray(c.decodeHw)
        && [...c.encodeHw, ...c.decodeHw].every(x => typeof x === "string");
}
