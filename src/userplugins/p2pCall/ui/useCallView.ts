/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@webpack/common";

import type { CallController, View } from "../controller";

export function useCallView(c: CallController): View {
    const [v, setV] = useState(c.view);
    useEffect(() => c.subscribe(() => setV(c.view)), [c]);
    return v;
}
