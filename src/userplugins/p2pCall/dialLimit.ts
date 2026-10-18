/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Ограничение частоты своих вызовов. Каждый вызов — десяток событий на каждый ретранслятор Nostr;
 * серия «позвонил-сбросил» за минуту ловит бан ретранслятора по IP, и сигналинг молча глохнет
 */

export const DIAL_GAP_MS = 3000;
export const DIAL_WINDOW_MS = 60_000;
export const DIAL_MAX_PER_WINDOW = 6;

/** Сколько ещё ждать до следующего вызова; 0 — можно звонить. history — времена прошлых вызовов */
export function dialWait(history: readonly number[], now: number): number {
    const recent = history.filter(t => now - t < DIAL_WINDOW_MS);
    const last = recent.length ? Math.max(...recent) : -Infinity;
    const gap = last + DIAL_GAP_MS - now;
    const window = recent.length >= DIAL_MAX_PER_WINDOW ? Math.min(...recent) + DIAL_WINDOW_MS - now : 0;
    return Math.max(0, gap, window);
}
