/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const SPEAK_ON = 0.04;
export const SPEAK_OFF = 0.02;
export const HOLD_MS = 300;

export function rms(buf: Float32Array): number {
    if (!buf.length) return 0;
    let sum = 0;
    for (const v of buf) sum += v * v;
    return Math.sqrt(sum / buf.length);
}

/** «Говорит» с гистерезисом: включение по SPEAK_ON, выключение после HOLD_MS ниже SPEAK_OFF */
export class SpeakingDetector {
    speaking = false;
    private quietSince: number | null = null;

    update(level: number, now: number): boolean {
        if (level >= SPEAK_ON) {
            this.speaking = true;
            this.quietSince = null;
        } else if (level < SPEAK_OFF) {
            if (this.speaking) {
                this.quietSince ??= now;
                if (now - this.quietSince >= HOLD_MS) {
                    this.speaking = false;
                    this.quietSince = null;
                }
            }
        } else {
            this.quietSince = null;
        }
        return this.speaking;
    }
}
