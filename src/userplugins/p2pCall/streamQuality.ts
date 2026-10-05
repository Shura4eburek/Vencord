/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type Height = 720 | 1080 | 1440 | 0;
export type Fps = 30 | 60 | 120 | 144;
export type MaxMbps = 10 | 20 | 40 | 80;
export type Prefer = "fps" | "detail";
export interface StreamQuality { height: Height; fps: Fps; maxMbps: MaxMbps; prefer: Prefer; }

export const HEIGHTS: readonly Height[] = [720, 1080, 1440, 0];
export const FPS_OPTIONS: readonly Fps[] = [30, 60, 120, 144];
export const MBPS_OPTIONS: readonly MaxMbps[] = [10, 20, 40, 80];
export const DEFAULT_QUALITY: StreamQuality = { height: 0, fps: 60, maxMbps: 20, prefer: "fps" };

// без предела: Chromium вписывает источник и выше исходного не увеличивает
const MAX_W = 7680;
const MAX_H = 4320;

export const heightLabel = (h: Height) => (h === 0 ? "Исходное" : `${h}p`);

export function captureConstraints(q: StreamQuality) {
    return { maxWidth: MAX_W, maxHeight: q.height || MAX_H, maxFrameRate: q.fps };
}

export function trackConstraints(q: StreamQuality): MediaTrackConstraints {
    return q.height ? { height: { max: q.height }, frameRate: { max: q.fps } } : { frameRate: { max: q.fps } };
}

export function encoderParams(q: StreamQuality) {
    const keepFps = q.prefer === "fps";
    return {
        maxBitrate: q.maxMbps * 1_000_000,
        maxFramerate: q.fps,
        degradationPreference: keepFps ? "maintain-framerate" as const : "maintain-resolution" as const,
        contentHint: keepFps ? "motion" as const : "detail" as const,
    };
}

export const fpsAllowed = (fps: Fps, hz: number) => fps <= hz * 1.05;

/** Частота монитора по интервалам requestAnimationFrame (медиана — устойчива к редким пропускам кадров) */
export function hzFromIntervals(intervals: number[]): number {
    if (!intervals.length) return 60;
    const sorted = [...intervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return Math.round(1000 / median);
}

const pick = <T>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? v as T : fallback);

export function sanitizeQuality(raw: Partial<Record<keyof StreamQuality, unknown>>): StreamQuality {
    return {
        height: pick(raw.height, HEIGHTS, DEFAULT_QUALITY.height),
        fps: pick(raw.fps, FPS_OPTIONS, DEFAULT_QUALITY.fps),
        maxMbps: pick(raw.maxMbps, MBPS_OPTIONS, DEFAULT_QUALITY.maxMbps),
        prefer: pick(raw.prefer, ["fps", "detail"] as const, DEFAULT_QUALITY.prefer),
    };
}

/** applyConstraints только уменьшает относительно исходного захвата — для повышения нужен новый захват */
export function needsRecapture(captured: StreamQuality, next: StreamQuality): boolean {
    const higher = captured.height !== 0 && (next.height === 0 || next.height > captured.height);
    return higher || next.fps > captured.fps;
}
