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
    if (areaVisible(v.call, channel.id)) return null;
    const busy = v.call.phase !== "idle" && v.call.phase !== "ended";
    const up = v.relaysUp > 0;
    const tooltip = !up ? "P2P-звонок: нет связи с сигналингом"
        : busy ? "P2P-звонок уже идёт"
            : "P2P-звонок (Shift — с камерой)";
    return (
        <HeaderBar.Icon
            icon={PhoneLinkIcon}
            tooltip={tooltip}
            disabled={!up || busy}
            onClick={(e: React.MouseEvent) => c.dial(channel.id, channel.recipients[0], e.shiftKey)}
        />
    );
}
