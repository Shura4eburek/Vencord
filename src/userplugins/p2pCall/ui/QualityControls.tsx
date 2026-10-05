/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classes } from "@utils/misc";
import { useEffect, useState } from "@webpack/common";

import { FPS_OPTIONS, fpsAllowed, heightLabel, HEIGHTS, hzFromIntervals, MBPS_OPTIONS, StreamQuality } from "../streamQuality";

/** Частота монитора: 500 мс requestAnimationFrame, медиана интервалов */
export function useRefreshRate(): number {
    const [hz, setHz] = useState(60);
    useEffect(() => {
        let raf = 0, last = 0, alive = true;
        const intervals: number[] = [];
        const start = performance.now();
        const tick = (t: number) => {
            if (!alive) return;
            if (last) intervals.push(t - last);
            last = t;
            if (t - start < 500) raf = requestAnimationFrame(tick);
            else setHz(hzFromIntervals(intervals));
        };
        raf = requestAnimationFrame(tick);
        return () => { alive = false; cancelAnimationFrame(raf); };
    }, []);
    return hz;
}

function Row<T extends string | number>({ label, options, value, text, disabled, onPick }: {
    label: string; options: readonly T[]; value: T; text(v: T): string; disabled?(v: T): boolean; onPick(v: T): void;
}) {
    return (
        <div className="p2p-q-row">
            <span className="p2p-q-label">{label}</span>
            <div className="p2p-q-options">
                {options.map(o => {
                    const off = disabled?.(o) ?? false;
                    return (
                        <button key={String(o)} disabled={off}
                            className={classes("p2p-q-opt", o === value && "p2p-q-on")}
                            onClick={() => onPick(o)}>
                            {text(o)}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export function QualityControls({ value, onChange, hz }: { value: StreamQuality; onChange(q: StreamQuality): void; hz: number; }) {
    return (
        <div className="p2p-q">
            <Row label="Разрешение" options={HEIGHTS} value={value.height} text={heightLabel} onPick={height => onChange({ ...value, height })} />
            <Row label="FPS" options={FPS_OPTIONS} value={value.fps} text={String} disabled={f => !fpsAllowed(f, hz)} onPick={fps => onChange({ ...value, fps })} />
            <Row label="Потолок" options={MBPS_OPTIONS} value={value.maxMbps} text={m => `${m} Мбит/с`} onPick={maxMbps => onChange({ ...value, maxMbps })} />
            <Row label="При нехватке" options={["fps", "detail"] as const} value={value.prefer}
                text={p => (p === "fps" ? "держать FPS" : "держать чёткость")} onPick={prefer => onChange({ ...value, prefer })} />
        </div>
    );
}
