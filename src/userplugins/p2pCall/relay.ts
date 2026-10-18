/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface NostrEvent { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string; }
export interface NostrFilter { kinds: number[]; "#t": string[]; }
export interface WsLike {
    readyState: number;
    send(data: string): void;
    close(): void;
    onopen: (() => void) | null;
    onmessage: ((ev: { data: string; }) => void) | null;
    onclose: (() => void) | null;
    onerror: (() => void) | null;
}
export type WsFactory = (url: string) => WsLike;
export type Scheduler = (fn: () => void, ms: number) => unknown;

export const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];
/** Ретранслятор отказал по лимиту: пауза в отправке. Бан — надолго, «rate-limited» — коротко */
export const LIMIT_PAUSE_MS = 30_000;
export const BAN_PAUSE_MS = 10 * 60_000;

/** Отказ ретранслятора: OK false на наше событие или NOTICE */
export interface RelayReject { url: string; reason: string; paused: boolean; }

/** Отказ из-за лимитов: дальше слать бессмысленно — только продлим бан */
export function limitPause(reason: string): number {
    const r = reason.toLowerCase();
    if (/^(banned|blocked)\b|too many rate-limit/.test(r)) return BAN_PAUSE_MS;
    if (/^rate-limited\b|rate.?limit|slow down|too (many|fast)/.test(r)) return LIMIT_PAUSE_MS;
    return 0;
}

export class RelayConn {
    private ws: WsLike | null = null;
    private subs = new Map<string, NostrFilter>();
    private attempt = 0;
    private timer: unknown = null;
    private stopped = true;
    private isUp = false;
    /** До какого времени ретранслятор отказывает по лимиту: не шлём и не считаем живым */
    private pausedUntil = 0;
    private pauseTimer: unknown = null;

    constructor(
        readonly url: string,
        private makeWs: WsFactory,
        private onEvent: (ev: NostrEvent) => void,
        private onStatus: (up: boolean) => void,
        private schedule: Scheduler = (fn, ms) => setTimeout(fn, ms),
        private cancel: (h: unknown) => void = h => clearTimeout(h as ReturnType<typeof setTimeout>),
        private onReject: (r: RelayReject) => void = () => { },
        private now: () => number = Date.now,
    ) { }

    /** Живой — подключён и не отказывает по лимиту */
    get up() { return this.isUp && this.now() >= this.pausedUntil; }

    start() {
        this.stopped = false;
        this.connect();
    }

    stop() {
        this.stopped = true;
        if (this.timer != null) this.cancel(this.timer);
        this.timer = null;
        if (this.pauseTimer != null) this.cancel(this.pauseTimer);
        this.pauseTimer = null;
        const { ws } = this;
        this.ws = null;
        ws?.close();
        this.setUp(false);
    }

    publish(ev: NostrEvent) {
        if (this.up) this.ws!.send(JSON.stringify(["EVENT", ev]));
    }

    subscribe(id: string, filter: NostrFilter) {
        this.subs.set(id, filter);
        if (this.isUp) this.ws!.send(JSON.stringify(["REQ", id, filter]));
    }

    unsubscribe(id: string) {
        if (!this.subs.delete(id)) return;
        if (this.isUp) this.ws!.send(JSON.stringify(["CLOSE", id]));
    }

    private setUp(up: boolean) {
        if (this.isUp === up) return;
        this.isUp = up;
        this.onStatus(this.up);
    }

    private reject(reason: string) {
        const pause = limitPause(reason);
        if (pause) {
            const wasUp = this.up;
            this.pausedUntil = Math.max(this.pausedUntil, this.now() + pause);
            if (this.pauseTimer != null) this.cancel(this.pauseTimer);
            this.pauseTimer = this.schedule(() => { this.pauseTimer = null; this.onStatus(this.up); }, this.pausedUntil - this.now());
            if (wasUp) this.onStatus(false);
        }
        this.onReject({ url: this.url, reason, paused: pause > 0 });
    }

    private connect() {
        const ws = this.makeWs(this.url);
        this.ws = ws;
        ws.onopen = () => {
            if (this.ws !== ws) return;
            this.attempt = 0;
            this.setUp(true);
            for (const [id, f] of this.subs) ws.send(JSON.stringify(["REQ", id, f]));
        };
        ws.onmessage = ({ data }) => {
            let msg: unknown;
            try { msg = JSON.parse(data); } catch { return; }
            if (!Array.isArray(msg)) return;
            if (msg[0] === "EVENT" && msg[2] && typeof msg[2] === "object") this.onEvent(msg[2] as NostrEvent);
            // отказ раньше проглатывался молча: сообщения не доходили, а сигналинг считался живым
            else if (msg[0] === "OK" && msg[2] === false) this.reject(String(msg[3] ?? ""));
            else if (msg[0] === "NOTICE" || msg[0] === "CLOSED") this.reject(String(msg[msg[0] === "CLOSED" ? 2 : 1] ?? ""));
        };
        ws.onerror = () => { };
        ws.onclose = () => {
            if (this.ws !== ws) return;
            this.ws = null;
            this.setUp(false);
            if (this.stopped) return;
            const ms = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
            this.attempt++;
            this.timer = this.schedule(() => { this.timer = null; if (!this.stopped) this.connect(); }, ms);
        };
    }
}

/** Ретрансляторы по умолчанию: пять, чтобы бан на одном-двух не глушил сигналинг */
export const DEFAULT_RELAY_LIST = ["wss://relay.damus.io", "wss://nos.lol", "wss://nostr.mom", "wss://relay.primal.net", "wss://relay.nostr.net"];
/** Прежние списки по умолчанию: у тех, кто их не менял, заменяются новым */
const OLD_DEFAULTS = ["wss://relay.damus.io, wss://nos.lol, wss://nostr.mom"];

export function upgradeRelays(current: string): string {
    return OLD_DEFAULTS.includes(current.trim()) ? DEFAULT_RELAY_LIST.join(", ") : current;
}

/** Источник для CSP connect-src. Хост без схемы разрешает только https, поэтому wss указываем явно */
export function relayCspSource(url: string): string | null {
    try {
        const u = new URL(url);
        return u.protocol === "wss:" || u.protocol === "ws:" ? `${u.protocol}//${u.host}` : null;
    } catch {
        return null;
    }
}
