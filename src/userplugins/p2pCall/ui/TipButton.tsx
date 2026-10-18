/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Tooltip } from "@webpack/common";

/** Кнопка-иконка с родным тултипом Discord; подпись тултипа — и aria-label */
export function TipButton({ tip, className, onClick, children }: { tip: string; className: string; onClick(e: React.MouseEvent): void; children: React.ReactNode; }) {
    return (
        <Tooltip text={tip}>
            {props => (
                <button {...props} className={className} onClick={onClick} aria-label={tip}>
                    {children}
                </button>
            )}
        </Tooltip>
    );
}
