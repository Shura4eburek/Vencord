/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type PathType = "host" | "srflx" | "relay" | "unknown";
export interface Counters { at: number; recvBytes: number; sentBytes: number; lost: number; received: number; }
export type Limit = "none" | "cpu" | "bandwidth" | "other";
/** srcFps — сколько кадров отдаёт захват кодеру (media-source); fps — сколько кодер отправляет */
export interface VideoSide { width: number; height: number; fps: number; codec: string | null; hw: boolean | null; limit: Limit | null; srcFps: number | null; }
export interface CallStats {
    rttMs: number | null; lossPct: number; inKbps: number; outKbps: number; path: PathType; counters: Counters;
    video: { out: VideoSide | null; in: VideoSide | null; };
}

const RANK: Record<string, PathType> = { host: "host", srflx: "srflx", prflx: "srflx", relay: "relay" };
const ORDER: PathType[] = ["unknown", "host", "srflx", "relay"];

const LIMITS: Limit[] = ["none", "cpu", "bandwidth", "other"];

function biggest(reports: any[], type: string) {
    let best: any = null;
    for (const r of reports) {
        if (r.type !== type || r.kind !== "video") continue;
        const px = (r.frameWidth ?? 0) * (r.frameHeight ?? 0);
        if (!best || px > (best.frameWidth ?? 0) * (best.frameHeight ?? 0)) best = r;
    }
    return best;
}

function videoSide(r: any, byId: Map<string, any>, out: boolean): VideoSide | null {
    if (!r) return null;
    const hwFlag = out ? r.powerEfficientEncoder : r.powerEfficientDecoder;
    return {
        width: r.frameWidth ?? 0,
        height: r.frameHeight ?? 0,
        fps: Math.round(r.framesPerSecond ?? 0),
        codec: byId.get(r.codecId)?.mimeType ?? null,
        hw: typeof hwFlag === "boolean" ? hwFlag : null,
        limit: out ? (LIMITS.includes(r.qualityLimitationReason) ? r.qualityLimitationReason : "other") : null,
        srcFps: out && typeof byId.get(r.mediaSourceId)?.framesPerSecond === "number" ? Math.round(byId.get(r.mediaSourceId).framesPerSecond) : null,
    };
}

export interface TrackIds { outTrack?: string | null; inTrack?: string | null; }

/** Отправка — по треку демки (media-source.trackIdentifier), приём — по треку демки собеседника; без них — самый большой кадр */
function pickVideo(all: any[], byId: Map<string, any>, type: string, trackId: string | null | undefined) {
    if (trackId) {
        const hit = all.find(r => r.type === type && r.kind === "video" && (
            type === "inbound-rtp" ? r.trackIdentifier === trackId : byId.get(r.mediaSourceId)?.trackIdentifier === trackId));
        if (hit) return hit;
    }
    return biggest(all, type);
}

export function summarizeStats(reports: Iterable<any>, now: number, prev?: Counters, ids: TrackIds = {}): CallStats {
    const byId = new Map<string, any>();
    const counters: Counters = { at: now, recvBytes: 0, sentBytes: 0, lost: 0, received: 0 };
    let pairId: string | undefined;

    // reports из сессии — одноразовый итератор, а пройти его нужно несколько раз
    const all = [...reports];
    for (const r of all) {
        byId.set(r.id, r);
        if (r.type === "transport" && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId;
        if (r.type === "inbound-rtp") {
            counters.recvBytes += r.bytesReceived ?? 0;
            counters.lost += Math.max(0, r.packetsLost ?? 0);
            counters.received += r.packetsReceived ?? 0;
        }
        if (r.type === "outbound-rtp") counters.sentBytes += r.bytesSent ?? 0;
    }

    let rttMs: number | null = null;
    let path: PathType = "unknown";
    const pair = pairId ? byId.get(pairId) : undefined;
    if (pair) {
        if (typeof pair.currentRoundTripTime === "number") rttMs = Math.round(pair.currentRoundTripTime * 1000);
        for (const id of [pair.localCandidateId, pair.remoteCandidateId]) {
            const t = RANK[byId.get(id)?.candidateType] ?? "unknown";
            if (ORDER.indexOf(t) > ORDER.indexOf(path)) path = t;
        }
    }

    let lossPct = 0, inKbps = 0, outKbps = 0;
    if (prev && now > prev.at) {
        const dLost = counters.lost - prev.lost;
        const dRecv = counters.received - prev.received;
        if (dLost + dRecv > 0) lossPct = Math.round((dLost / (dLost + dRecv)) * 1000) / 10;
        const dt = (now - prev.at) / 1000;
        inKbps = Math.round(((counters.recvBytes - prev.recvBytes) * 8) / 1000 / dt);
        outKbps = Math.round(((counters.sentBytes - prev.sentBytes) * 8) / 1000 / dt);
    }

    const video = {
        out: videoSide(pickVideo(all, byId, "outbound-rtp", ids.outTrack), byId, true),
        in: videoSide(pickVideo(all, byId, "inbound-rtp", ids.inTrack), byId, false),
    };

    return { rttMs, lossPct, inKbps, outKbps, path, counters, video };
}
