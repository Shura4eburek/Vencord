/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useRef, useState } from "@webpack/common";

import type { CallController } from "../controller";
import type { StreamQuality } from "../streamQuality";
import { QualityControls, useRefreshRate } from "./QualityControls";

/** Поповер над кнопкой идущей демки: качество на ходу и остановка (specs/005-call-redesign US3) */
export function StreamQualityPopover({ c, quality, onClose }: { c: CallController; quality: StreamQuality; onClose(): void; }) {
    const hz = useRefreshRate();
    const [draft, setDraft] = useState(quality);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        // клик по самой кнопке демки закрывает поповер её же обработчиком — его не считаем «мимо»
        const outside = (e: MouseEvent) => { if (!ref.current?.parentElement?.contains(e.target as Node)) onClose(); };
        const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
        window.addEventListener("mousedown", outside);
        window.addEventListener("keydown", esc, true);
        return () => { window.removeEventListener("mousedown", outside); window.removeEventListener("keydown", esc, true); };
    }, []);
    return (
        <div className="p2p-popover" ref={ref} role="dialog" aria-label="Качество демонстрации">
            <QualityControls value={draft} hz={hz} onChange={setDraft} />
            <div className="p2p-popover-actions">
                <button className="p2p-btn p2p-btn-danger" onClick={() => { c.stopScreen(); onClose(); }}>Остановить</button>
                <button className="p2p-btn p2p-btn-brand" onClick={() => { c.setScreenQuality(draft); onClose(); }}>Применить</button>
            </div>
        </div>
    );
}
