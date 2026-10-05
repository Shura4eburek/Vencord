/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { rms, SpeakingDetector } from "./speaking";

const POLL_MS = 100;

/** Уровень громкости потока → «говорит/молчит»; onChange только при смене */
export class LevelMeter {
    private src: MediaStreamAudioSourceNode;
    private analyser: AnalyserNode;
    private buf: Float32Array<ArrayBuffer>;
    private detector = new SpeakingDetector();
    private timer: ReturnType<typeof setInterval>;

    constructor(ctx: AudioContext, readonly stream: MediaStream, onChange: (speaking: boolean) => void, gate: () => boolean) {
        this.src = ctx.createMediaStreamSource(stream);
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 512;
        this.buf = new Float32Array(this.analyser.fftSize);
        this.src.connect(this.analyser);
        this.timer = setInterval(() => {
            this.analyser.getFloatTimeDomainData(this.buf);
            const before = this.detector.speaking;
            const now = this.detector.update(gate() ? rms(this.buf) : 0, performance.now());
            if (now !== before) onChange(now);
        }, POLL_MS);
    }

    stop() {
        clearInterval(this.timer);
        this.src.disconnect();
    }
}
