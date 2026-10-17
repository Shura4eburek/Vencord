/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Загрузчик сетевого модуля dist/p2pcall-net.js (specs/002-update-apply-modes R3). Из net.ts — только типы:
// импорт значений затащил бы туннель в patcher.js, и любая его правка требовала бы перезапуска Discord.

import { statSync } from "fs";

import type { NetApi, NetEnv } from "./net";

export interface NetModule { createNet(env: NetEnv): NetApi; }

function freshRequire(path: string): NetModule {
    delete require.cache[require.resolve(path)];
    return require(path);
}

export class NetLoader {
    /** Новый файл не загрузился — работает прежний модуль, обновлению нужен перезапуск Discord */
    broken = false;
    private api: NetApi | null = null;
    private stamp: string | null = null;

    /** canSwap — false, пока ждём перезапуска Discord: новый модуль может рассчитывать на новый native.ts */
    constructor(private path: string, private env: NetEnv, private load: (path: string) => NetModule = freshRequire, private canSwap: () => boolean = () => true) { }

    /** Без перезагрузки: для звонка, который уже идёт */
    current() { return this.api; }

    /** Подхватывает новый файл (по mtime и размеру), только если туннеля сейчас нет */
    get(): NetApi | null {
        let stamp: string;
        try {
            const st = statSync(this.path);
            stamp = `${st.mtimeMs}:${st.size}`;
        } catch {
            return this.api;
        }
        if (stamp === this.stamp || this.api?.activeCallId() || (this.api && !this.canSwap())) return this.api;
        this.stamp = stamp;
        try {
            const next = this.load(this.path).createNet(this.env);
            this.api?.dispose();
            this.api = next;
            this.broken = false;
        } catch (e) {
            console.error("[P2PCall] net module", e);
            this.broken = true;
        }
        return this.api;
    }
}
