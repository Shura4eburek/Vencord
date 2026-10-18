/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Вкладки «Звонок Discord / P2P», когда в одном ЛС идут оба звонка (specs/005-call-redesign R4) */

export type Tab = "discord" | "p2p";
export interface TabSeen { discord: number | null; p2p: number | null; }

/** Какая вкладка показана; null — звонок один, вкладок нет. Без выбора — звонок, начатый последним */
export function pickTab(seen: TabSeen, pick?: Tab): Tab | null {
    if (seen.discord == null || seen.p2p == null) return null;
    if (pick) return pick;
    return seen.discord > seen.p2p ? "discord" : "p2p";
}

const seenBy = new Map<string, TabSeen>();
const pickBy = new Map<string, Tab>();

/** Отметить, какие звонки сейчас идут в канале; пропавший звонок сбрасывает ручной выбор */
export function trackSeen(channelId: string, discord: boolean, p2p: boolean, now = Date.now()): TabSeen {
    const old = seenBy.get(channelId) ?? { discord: null, p2p: null };
    const next: TabSeen = {
        discord: discord ? old.discord ?? now : null,
        p2p: p2p ? old.p2p ?? now : null,
    };
    if (next.discord == null || next.p2p == null) pickBy.delete(channelId);
    if (next.discord == null && next.p2p == null) seenBy.delete(channelId);
    else seenBy.set(channelId, next);
    return next;
}

export const getPick = (channelId: string) => pickBy.get(channelId);
export const setPick = (channelId: string, tab: Tab) => { pickBy.set(channelId, tab); };
