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

export class RelayConn {
    private ws: WsLike | null = null;
    private subs = new Map<string, NostrFilter>();
    private attempt = 0;
    private timer: unknown = null;
    private stopped = true;
    private isUp = false;

    constructor(
        readonly url: string,
        private makeWs: WsFactory,
        private onEvent: (ev: NostrEvent) => void,
        private onStatus: (up: boolean) => void,
        private schedule: Scheduler = (fn, ms) => setTimeout(fn, ms),
        private cancel: (h: unknown) => void = h => clearTimeout(h as ReturnType<typeof setTimeout>),
    ) { }

    get up() { return this.isUp; }

    start() {
        this.stopped = false;
        this.connect();
    }

    stop() {
        this.stopped = true;
        if (this.timer != null) this.cancel(this.timer);
        this.timer = null;
        const { ws } = this;
        this.ws = null;
        ws?.close();
        this.setUp(false);
    }

    publish(ev: NostrEvent) {
        if (this.isUp) this.ws!.send(JSON.stringify(["EVENT", ev]));
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
        this.onStatus(up);
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
            if (Array.isArray(msg) && msg[0] === "EVENT" && msg[2] && typeof msg[2] === "object") this.onEvent(msg[2] as NostrEvent);
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

/** Источник для CSP connect-src. Хост без схемы разрешает только https, поэтому wss указываем явно */
export function relayCspSource(url: string): string | null {
    try {
        const u = new URL(url);
        return u.protocol === "wss:" || u.protocol === "ws:" ? `${u.protocol}//${u.host}` : null;
    } catch {
        return null;
    }
}
