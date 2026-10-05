/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

// JSX на верхнем уровне модуля выполняется до появления глобального Vencord и роняет весь клиент
test("importing ui/icons creates no JSX elements at load time", async () => {
    await assert.doesNotReject(import("./ui/icons"));
});
