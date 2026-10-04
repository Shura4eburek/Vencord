/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface OpusTuning { maxAverageBitrate: number; ptime: number; }

export const DEFAULT_OPUS: OpusTuning = { maxAverageBitrate: 128_000, ptime: 10 };

export function tuneOpus(sdp: string, t: OpusTuning): string {
    const lines = sdp.split("\r\n");
    const rtpIdx = lines.findIndex(l => /^a=rtpmap:\d+ opus\/48000/i.test(l));
    if (rtpIdx < 0) return sdp;
    const pt = lines[rtpIdx].match(/^a=rtpmap:(\d+)/)![1];
    const prefix = `a=fmtp:${pt} `;
    const want: Record<string, string> = {
        useinbandfec: "1",
        maxaveragebitrate: String(t.maxAverageBitrate),
        minptime: String(t.ptime),
    };

    const fmtpIdx = lines.findIndex(l => l.startsWith(prefix));
    if (fmtpIdx >= 0) {
        const params = new Map<string, string>();
        for (const p of lines[fmtpIdx].slice(prefix.length).split(";")) {
            if (!p) continue;
            const [k, v = ""] = p.split("=");
            params.set(k.trim(), v.trim());
        }
        for (const [k, v] of Object.entries(want)) params.set(k, v);
        lines[fmtpIdx] = prefix + [...params].map(([k, v]) => `${k}=${v}`).join(";");
    } else {
        lines.splice(rtpIdx + 1, 0, prefix + Object.entries(want).map(([k, v]) => `${k}=${v}`).join(";"));
    }

    const mAudio = lines.findIndex(l => l.startsWith("m=audio"));
    let end = lines.findIndex((l, i) => i > mAudio && l.startsWith("m="));
    if (end < 0) end = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
    const ptimeIdx = lines.findIndex((l, i) => i > mAudio && i < end && l.startsWith("a=ptime:"));
    if (ptimeIdx >= 0) lines[ptimeIdx] = `a=ptime:${t.ptime}`;
    else lines.splice(end, 0, `a=ptime:${t.ptime}`);

    return lines.join("\r\n");
}
