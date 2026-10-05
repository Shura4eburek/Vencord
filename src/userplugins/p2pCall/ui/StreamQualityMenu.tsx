/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useRef, useState } from "@webpack/common";

import type { CallController } from "../controller";
import { QualityControls, useRefreshRate } from "./QualityControls";
import { useCallView } from "./useCallView";

/** Стрелочка у кнопки демки: качество идущей демки на ходу */
export function StreamQualityMenu({ c, up }: { c: CallController; up?: boolean; }) {
    const v = useCallView(c);
    const hz = useRefreshRate();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
        window.addEventListener("mousedown", close);
        return () => window.removeEventListener("mousedown", close);
    }, [open]);
    if (!v.local.screen) return null;
    return (
        <div className="p2p-qmenu" ref={ref}>
            <button className="p2p-qmenu-btn" aria-label="Качество демки" onClick={() => setOpen(!open)}>▾</button>
            {open && (
                <div className={up ? "p2p-qmenu-pop p2p-qmenu-up" : "p2p-qmenu-pop"}>
                    <QualityControls value={v.screenQuality} hz={hz} onChange={q => c.setScreenQuality(q)} />
                </div>
            )}
        </div>
    );
}
