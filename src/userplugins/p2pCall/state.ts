/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface Peer { callId: string; peerId: string; channelId: string; }
export type EndReason = "hangup" | "remote-hangup" | "declined" | "busy" | "no-answer" | "ice-timeout" | "ice-failed";
export type CallState =
    | { phase: "idle"; }
    | ({ phase: "outgoing"; video: boolean; } & Peer)
    | ({ phase: "incoming"; video: boolean; } & Peer)
    | ({ phase: "connecting"; } & Peer)
    | ({ phase: "connected"; } & Peer)
    | { phase: "ended"; reason: EndReason; peerId: string; channelId: string; };
export type CallEvent =
    | ({ type: "dial"; video: boolean; } & Peer)
    | ({ type: "ring"; video: boolean; } & Peer)
    | { type: "accept"; }
    | { type: "decline"; }
    | { type: "remote-accept"; callId: string; }
    | { type: "remote-decline"; callId: string; reason: "declined" | "busy"; }
    | { type: "remote-bye"; callId: string; }
    | { type: "ice-connected"; }
    | { type: "ice-failed"; }
    | { type: "hangup"; }
    | { type: "timeout"; which: "ring" | "ice"; callId: string; }
    | { type: "reset"; };
export type Effect =
    | { kind: "send-ring"; peer: Peer; video: boolean; }
    | { kind: "send"; peer: Peer; msg: { type: "accept"; } | { type: "decline"; reason: "declined" | "busy"; } | { type: "bye"; reason: string; }; }
    | { kind: "join-room"; peer: Peer; }
    | { kind: "leave-room"; callId: string; }
    | { kind: "start-session"; peer: Peer; video: boolean; }
    | { kind: "stop-session"; }
    | { kind: "start-timer"; which: "ring" | "ice"; callId: string; }
    | { kind: "clear-timers"; }
    | { kind: "ringtone"; on: boolean; }
    | { kind: "offer-fallback"; channelId: string; };

type Result = { state: CallState; effects: Effect[]; };
type Active = Extract<CallState, Peer>;

export const isPolite = (selfId: string, peerId: string) => BigInt(selfId) < BigInt(peerId);

const peerOf = (s: Active): Peer => ({ callId: s.callId, peerId: s.peerId, channelId: s.channelId });
const isActive = (s: CallState): s is Active => s.phase !== "idle" && s.phase !== "ended";

const FALLBACK: EndReason[] = ["no-answer", "ice-timeout", "ice-failed"];

function end(s: Active, reason: EndReason, bye: boolean): Result {
    const effects: Effect[] = [{ kind: "clear-timers" }];
    // выключить уже выключенный звонок безвредно
    if (s.phase !== "outgoing") effects.push({ kind: "ringtone", on: false });
    if (bye) effects.push({ kind: "send", peer: peerOf(s), msg: { type: "bye", reason } });
    if (s.phase === "connecting" || s.phase === "connected") effects.push({ kind: "stop-session" });
    effects.push({ kind: "leave-room", callId: s.callId });
    if (FALLBACK.includes(reason)) effects.push({ kind: "offer-fallback", channelId: s.channelId });
    return { state: { phase: "ended", reason, peerId: s.peerId, channelId: s.channelId }, effects };
}

const same = (s: CallState): Result => ({ state: s, effects: [] });

export function reduce(s: CallState, e: CallEvent): Result {
    switch (e.type) {
        case "dial": {
            if (s.phase !== "idle") return same(s);
            const peer: Peer = { callId: e.callId, peerId: e.peerId, channelId: e.channelId };
            return {
                state: { phase: "outgoing", video: e.video, ...peer },
                effects: [
                    { kind: "join-room", peer },
                    { kind: "send-ring", peer, video: e.video },
                    { kind: "start-timer", which: "ring", callId: e.callId },
                ],
            };
        }
        case "ring": {
            const peer: Peer = { callId: e.callId, peerId: e.peerId, channelId: e.channelId };
            if (isActive(s)) {
                if (s.callId === e.callId) return same(s);
                return {
                    state: s,
                    effects: [
                        { kind: "join-room", peer },
                        { kind: "send", peer, msg: { type: "decline", reason: "busy" } },
                        { kind: "leave-room", callId: e.callId },
                    ],
                };
            }
            return {
                state: { phase: "incoming", video: e.video, ...peer },
                effects: [
                    { kind: "join-room", peer },
                    { kind: "ringtone", on: true },
                    { kind: "start-timer", which: "ring", callId: e.callId },
                ],
            };
        }
        case "accept": {
            if (s.phase !== "incoming") return same(s);
            const peer = peerOf(s);
            return {
                state: { phase: "connecting", ...peer },
                effects: [
                    { kind: "ringtone", on: false },
                    { kind: "clear-timers" },
                    { kind: "send", peer, msg: { type: "accept" } },
                    { kind: "start-session", peer, video: false },
                    { kind: "start-timer", which: "ice", callId: s.callId },
                ],
            };
        }
        case "decline": {
            if (s.phase !== "incoming") return same(s);
            const r = end(s, "declined", false);
            r.effects.splice(2, 0, { kind: "send", peer: peerOf(s), msg: { type: "decline", reason: "declined" } });
            return r;
        }
        case "remote-accept": {
            if (s.phase !== "outgoing" || s.callId !== e.callId) return same(s);
            const peer = peerOf(s);
            return {
                state: { phase: "connecting", ...peer },
                effects: [
                    { kind: "clear-timers" },
                    { kind: "start-session", peer, video: s.video },
                    { kind: "start-timer", which: "ice", callId: s.callId },
                ],
            };
        }
        case "remote-decline":
            if (s.phase !== "outgoing" || s.callId !== e.callId) return same(s);
            return end(s, e.reason, false);
        case "remote-bye":
            if (!isActive(s) || s.callId !== e.callId) return same(s);
            return end(s, "remote-hangup", false);
        case "ice-connected":
            if (s.phase !== "connecting") return same(s);
            return { state: { phase: "connected", ...peerOf(s) }, effects: [{ kind: "clear-timers" }] };
        case "ice-failed":
            if (s.phase !== "connecting" && s.phase !== "connected") return same(s);
            return end(s, "ice-failed", true);
        case "hangup":
            if (!isActive(s)) return same(s);
            return s.phase === "incoming" ? reduce(s, { type: "decline" }) : end(s, "hangup", true);
        case "timeout": {
            if (!isActive(s) || s.callId !== e.callId) return same(s);
            if (e.which === "ring" && (s.phase === "outgoing" || s.phase === "incoming"))
                return end(s, "no-answer", s.phase === "outgoing");
            if (e.which === "ice" && s.phase === "connecting") return end(s, "ice-timeout", true);
            return same(s);
        }
        case "reset":
            return s.phase === "ended" ? { state: { phase: "idle" }, effects: [] } : same(s);
    }
}
