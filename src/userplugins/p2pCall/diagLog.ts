/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { CallStats, Limit, VideoSide } from "./stats";

export const LIMIT_TEXT: Record<Limit, string> = { none: "нет", cpu: "процессор", bandwidth: "канал", other: "другое" };

const short = (codec: string | null) => codec?.replace(/^video\//, "") ?? null;

function videoLine(v: VideoSide | null): string | null {
    if (!v) return null;
    const parts = [`${v.width}x${v.height}@${v.fps}`];
    if (v.codec) parts.push(short(v.codec)!);
    if (v.hw !== null) parts.push(v.hw ? "hw" : "sw");
    if (v.limit) parts.push(`limit=${v.limit}`);
    if (v.srcFps !== null) parts.push(`src=${v.srcFps}fps`);
    return parts.join(" ");
}

/** Сводка для строки «[P2PCall] stats» в логе Discord */
export function compactStats(s: CallStats) {
    return {
        rtt: s.rttMs, loss: s.lossPct, inKbps: s.inKbps, outKbps: s.outKbps, path: s.path,
        vOut: videoLine(s.video.out), vIn: videoLine(s.video.in),
    };
}

/** Подпись для чипа: «1440p · 118 FPS · AV1 (аппаратный) · ограничение: канал» */
export function videoLabel(v: VideoSide): string {
    const parts = [`${v.height}p`, `${v.fps} FPS`];
    if (v.codec) parts.push(v.hw === null ? short(v.codec)! : `${short(v.codec)} (${v.hw ? "аппаратный" : "программный"})`);
    if (v.limit && v.limit !== "none") parts.push(`ограничение: ${LIMIT_TEXT[v.limit]}`);
    return parts.join(" · ");
}
