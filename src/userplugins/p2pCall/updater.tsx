/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { PluginNative } from "@utils/types";
import { Button, showToast, Toasts, useState } from "@webpack/common";

import type { UpdateResult } from "./native";

const Native = VencordNative.pluginHelpers.P2PCall as PluginNative<typeof import("./native")>;

const FIRST_CHECK_MS = 10_000;
const EVERY_MS = 6 * 60 * 60 * 1000;

let firstTimer: ReturnType<typeof setTimeout> | undefined;
let everyTimer: ReturnType<typeof setInterval> | undefined;

/** Штатный перезапуск Discord (им же Discord перезапускается после своих обновлений) — сохраняет вход в аккаунт */
function relaunchDiscord() {
    const discordRelaunch = (window as any).DiscordNative?.app?.relaunch;
    if (typeof discordRelaunch === "function") discordRelaunch();
    else Native.relaunch();
}

function notifyUpdated(version: string) {
    showNotification({
        title: "P2PCall обновлён",
        body: `Версия ${version}. Нажми, чтобы перезапустить Discord`,
        permanent: true,
        onClick: relaunchDiscord,
    });
}

export async function checkNow(): Promise<UpdateResult> {
    const r = await Native.checkForUpdate();
    if (r.status === "updated") notifyUpdated(r.version);
    else if (r.status === "error") console.warn("[P2PCall] update", r.error);
    return r;
}

export function startUpdater(enabled: () => boolean) {
    stopUpdater();
    const tick = () => { if (enabled()) checkNow().catch(e => console.warn("[P2PCall] update", e)); };
    firstTimer = setTimeout(tick, FIRST_CHECK_MS);
    everyTimer = setInterval(tick, EVERY_MS);
}

export function stopUpdater() {
    clearTimeout(firstTimer);
    clearInterval(everyTimer);
}

const TEXT: Record<UpdateResult["status"], string> = {
    dev: "Рабочая сборка из репозитория — автообновление отключено",
    latest: "Уже последняя версия",
    updated: "Обновлено — перезапусти Discord",
    error: "Ошибка обновления",
};

export function CheckNowButton() {
    const [busy, setBusy] = useState(false);
    return (
        <Button disabled={busy} onClick={async () => {
            setBusy(true);
            try {
                const r = await checkNow();
                const extra = r.status === "error" ? `: ${r.error}` : r.version ? ` (${r.version})` : "";
                showToast(TEXT[r.status] + extra, r.status === "error" ? Toasts.Type.FAILURE : Toasts.Type.SUCCESS);
            } finally {
                setBusy(false);
            }
        }}>
            {busy ? "Проверяю…" : "Проверить обновление"}
        </Button>
    );
}
