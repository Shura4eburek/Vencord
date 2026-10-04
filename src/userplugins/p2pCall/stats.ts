/*
 * P2PCall — сводка RTCStatsReport для полоски статистики
 */
export type PathType = "host" | "srflx" | "relay" | "unknown";
export interface Counters { at: number; recvBytes: number; sentBytes: number; lost: number; received: number; }
export interface CallStats { rttMs: number | null; lossPct: number; inKbps: number; outKbps: number; path: PathType; counters: Counters; }

const RANK: Record<string, PathType> = { host: "host", srflx: "srflx", prflx: "srflx", relay: "relay" };
const ORDER: PathType[] = ["unknown", "host", "srflx", "relay"];

export function summarizeStats(reports: Iterable<any>, now: number, prev?: Counters): CallStats {
    const byId = new Map<string, any>();
    const counters: Counters = { at: now, recvBytes: 0, sentBytes: 0, lost: 0, received: 0 };
    let pairId: string | undefined;

    for (const r of reports) {
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

    return { rttMs, lossPct, inKbps, outKbps, path, counters };
}
