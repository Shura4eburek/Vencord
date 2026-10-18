/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Channel } from "@vencord/discord-types";

import type { CallController } from "../controller";
import { areaVisible } from "../state";
import { PhoneLinkIcon } from "./icons";
import { useCallView } from "./useCallView";

export function HeaderCallButton({ c, channel, HeaderBar }: { c: CallController; channel: Channel; HeaderBar: any; }) {
    const v = useCallView(c);
    if (areaVisible(v.call, channel.id, v.channels)) return null;
    // во время звонка кнопка зовёт собеседника в него (specs/004-group-calls US2)
    const busy = !v.inCall && v.call.phase !== "idle" && v.call.phase !== "ended";
    const full = v.inCall && v.members.length >= 4;
    const up = v.relaysUp > 0;
    const tooltip = !up ? "P2P-звонок: нет связи с сигналингом"
        : busy ? "P2P-звонок уже идёт"
            : full ? "В звонке уже 5 человек"
                : v.inCall ? "Добавить в P2P-звонок"
                    : "P2P-звонок (Shift — с камерой)";
    return (
        <HeaderBar.Icon
            icon={PhoneLinkIcon}
            tooltip={tooltip}
            disabled={!up || busy || full}
            onClick={(e: React.MouseEvent) => c.dial(channel.id, channel.recipients[0], e.shiftKey)}
        />
    );
}
