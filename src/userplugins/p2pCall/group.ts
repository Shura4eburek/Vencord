/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Состав группового звонка без «главного» участника (specs/004-group-calls R6): вступления и уходы
// сливаются одинаково у всех, поэтому состав сходится, в каком бы порядке ни пришли изменения.
// Чистые функции — без WebRTC и сигналинга.

export const MAX_MEMBERS = 5;
/** Нет `here` от участника дольше — он пропал (R7) */
export const STALE_MS = 15_000;

export interface RosterEntry { userId: string; joinedAt: number; by: string; }
export interface Tomb { userId: string; leftAt: number; }
export interface RosterWire { entries: RosterEntry[]; tombs: Tomb[]; }
export interface Group extends RosterWire { id: string; startedAt: number; }
/** Ключ участника для тех, кто ещё не его контакт: передаёт добавивший (R4) */
export interface MemberKey { userId: string; name: string; avatar: string | null; deviceId: string; publicKey: string; }

/** Одна запись на участника: самое позднее вступление (при равенстве — по `by`, чтобы слияние не зависело от порядка) */
function laterEntry(a: RosterEntry | undefined, b: RosterEntry) {
    if (!a) return b;
    if (b.joinedAt !== a.joinedAt) return b.joinedAt > a.joinedAt ? b : a;
    return b.by > a.by ? b : a;
}

function compact(entries: RosterEntry[], tombs: Tomb[]): RosterWire {
    const e = new Map<string, RosterEntry>();
    for (const x of entries) e.set(x.userId, laterEntry(e.get(x.userId), x));
    const t = new Map<string, Tomb>();
    for (const x of tombs) if ((t.get(x.userId)?.leftAt ?? -Infinity) < x.leftAt) t.set(x.userId, x);
    const byId = <T extends { userId: string; }>(m: Map<string, T>) => [...m.values()].sort((a, b) => a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);
    return { entries: byId(e), tombs: byId(t) };
}

export function newGroup(id: string, selfId: string, now: number): Group {
    return { id, startedAt: now, entries: [{ userId: selfId, joinedAt: now, by: selfId }], tombs: [] };
}

export function isMember(g: RosterWire, userId: string) {
    const e = g.entries.find(x => x.userId === userId);
    const t = g.tombs.find(x => x.userId === userId);
    return !!e && e.joinedAt > (t?.leftAt ?? -Infinity);
}

/** Участники по порядку вступления */
export function members(g: RosterWire): RosterEntry[] {
    return g.entries.filter(e => isMember(g, e.userId)).sort((a, b) => a.joinedAt - b.joinedAt || (a.userId < b.userId ? -1 : 1));
}

export const isFull = (g: RosterWire) => members(g).length >= MAX_MEMBERS;

/** null — места нет; уже в составе — без изменений */
export function join(g: Group, userId: string, by: string, now: number): Group | null {
    if (isMember(g, userId)) return g;
    if (isFull(g)) return null;
    return { ...g, ...compact([...g.entries, { userId, joinedAt: now, by }], g.tombs) };
}

export function leave(g: Group, userId: string, now: number): Group {
    if (!isMember(g, userId)) return g;
    // уход позже вступления даже при отстающих часах: иначе надгробие не перекрыло бы запись
    const at = Math.max(now, (g.entries.find(e => e.userId === userId)?.joinedAt ?? 0) + 1);
    return { ...g, ...compact(g.entries, [...g.tombs, { userId, leftAt: at }]) };
}

/** Идемпотентно, коммутативно и ассоциативно — состав сходится у всех */
export function mergeRoster(g: Group, w: RosterWire): Group {
    return { ...g, ...compact([...g.entries, ...w.entries], [...g.tombs, ...w.tombs]) };
}

export const toWire = (g: RosterWire): RosterWire => ({ entries: g.entries, tombs: g.tombs });

/** Связь между двумя участниками начинает тот, чей Discord ID меньше: встречных вызовов нет (R5) */
export const initiator = (a: string, b: string) => BigInt(a) < BigInt(b) ? a : b;

export const isAlone = (g: RosterWire, selfId: string) => members(g).every(m => m.userId === selfId);

/** Участники (кроме себя), о которых ничего не слышно дольше STALE_MS. Без отметки — ещё не проверяли */
export function stale(g: RosterWire, selfId: string, lastHere: ReadonlyMap<string, number>, now: number): string[] {
    return members(g).filter(m => {
        if (m.userId === selfId) return false;
        const at = lastHere.get(m.userId);
        return at !== undefined && now - at > STALE_MS;
    }).map(m => m.userId);
}

/** Валидация состава из сети: чужие данные — только строки и числа нужной формы */
export function parseRoster(w: unknown): RosterWire | null {
    if (!w || typeof w !== "object") return null;
    const { entries, tombs } = w as RosterWire;
    if (!Array.isArray(entries) || !Array.isArray(tombs) || entries.length > 32 || tombs.length > 32) return null;
    const id = (s: unknown) => typeof s === "string" && /^\d{1,20}$/.test(s);
    const num = (n: unknown) => typeof n === "number" && Number.isFinite(n);
    if (!entries.every(e => e && id(e.userId) && id(e.by) && num(e.joinedAt))) return null;
    if (!tombs.every(t => t && id(t.userId) && num(t.leftAt))) return null;
    return {
        entries: entries.map(e => ({ userId: e.userId, joinedAt: e.joinedAt, by: e.by })),
        tombs: tombs.map(t => ({ userId: t.userId, leftAt: t.leftAt })),
    };
}

export type RingRoute = "primary" | "invite" | "auto-accept" | "busy";
export interface RingCtx {
    /** Идёт звонок (хотя бы одна связь соединяется или соединена) */
    inCall: boolean;
    /** Не в звонке, но уже звоним кому-то или звонят нам */
    ringing: boolean;
    group: Group | null;
    from: string;
    auto: boolean;
    ringGroupId?: string;
}

/**
 * Куда девать входящий `ring` (R5, R8): во время звонка — окно приглашения вместо молчаливого «занят»;
 * `auto` — связь внутри своей группы от её участника, без окна; чужая группа — «занят»
 */
export function routeRing(c: RingCtx): RingRoute {
    if (c.auto) return c.inCall && c.group && c.ringGroupId === c.group.id && isMember(c.group, c.from) ? "auto-accept" : "busy";
    if (c.inCall) return "invite";
    return c.ringing ? "busy" : "primary";
}
