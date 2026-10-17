/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { PluginNative } from "@utils/types";
import { Button, showToast, Toasts, useState } from "@webpack/common";

import type { CheckResult } from "./native";
import { Action, strongest } from "./updateLogic";

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

/** Что показать пользователю (specs/002-update-apply-modes/contracts/update.md §3) */
const ACTION_TEXT: Record<Action, string> = {
    none: "ничего делать не нужно",
    reload: "перезагрузи окно",
    restart: "перезапусти Discord",
};

function notify(version: string | null, action: Action) {
    const head = version ? `P2PCall обновлён до ${version}` : "P2PCall";
    if (action === "none") {
        showNotification({ title: head, body: "Ничего делать не нужно — новая версия уже работает" });
        return;
    }
    showNotification({
        title: head,
        body: action === "reload" ? "Нажми, чтобы перезагрузить окно (пара секунд, вход сохранится)" : "Нажми, чтобы перезапустить Discord",
        permanent: true,
        onClick: action === "reload" ? () => location.reload() : relaunchDiscord,
    });
}

/** Звонок: во время него ничего не перезагружаем, итог ждёт его конца */
export interface CallGate { inCall(): boolean; onCallEnd(fn: () => void): () => void; }

let gate: CallGate = { inCall: () => false, onCallEnd: () => () => { } };
let deferred: { version: string | null; action: Action; } | null = null;
let unsubscribe: (() => void) | undefined;
let generation = 0;
/** Перезапуск без нового обновления (битый сетевой модуль) показываем один раз за сессию, не каждые 6 ч */
let restartShown = false;

function deliver(r: CheckResult) {
    const lone = r.status !== "updated" && r.pending === "restart" && !restartShown;
    if (r.status !== "updated" && !lone) return;
    if (r.pending === "restart") restartShown = true;
    const version = r.status === "updated" ? r.version : null;
    // pending уже включает это обновление и всё невыполненное раньше
    if (gate.inCall()) {
        deferred = { version: version ?? deferred?.version ?? null, action: strongest([deferred?.action ?? "none", r.pending]) };
        return;
    }
    notify(version, r.pending);
}

export async function checkNow(): Promise<CheckResult> {
    const raw = await Native.checkForUpdate();
    // старый main (новый renderer.js после Ctrl+R без перезапуска) не знает pending — значит, нужен перезапуск
    const r: CheckResult = { ...raw, pending: raw.pending ?? "restart" };
    deliver(r);
    if (r.status === "error") console.warn("[P2PCall] update", r.error);
    return r;
}

export function startUpdater(enabled: () => boolean, callGate: CallGate) {
    stopUpdater();
    gate = callGate;
    unsubscribe = gate.onCallEnd(() => {
        if (!deferred) return;
        const d = deferred;
        deferred = null;
        notify(d.version, d.action);
    });
    const tick = () => { if (enabled()) checkNow().catch(e => console.warn("[P2PCall] update", e)); };
    const gen = ++generation;
    // без сетевого модуля (первый переход со старой версии) туннель не работает — не ждём 10 с;
    // старый main этого метода не знает — обычная задержка
    const missing = typeof Native.netMissing === "function" ? Native.netMissing() : Promise.resolve(false);
    missing.catch(() => false).then(m => {
        if (gen !== generation) return;
        firstTimer = setTimeout(tick, m ? 0 : FIRST_CHECK_MS);
    });
    everyTimer = setInterval(tick, EVERY_MS);
}

export function stopUpdater() {
    generation++;
    clearTimeout(firstTimer);
    clearInterval(everyTimer);
    unsubscribe?.();
    unsubscribe = undefined;
}

/** Текст под кнопкой «Проверить обновление» */
export function resultText(r: CheckResult): string {
    switch (r.status) {
        case "dev": return "Рабочая сборка из репозитория — автообновление отключено";
        case "error": return `Ошибка обновления: ${r.error}`;
        case "latest": return r.pending === "none" ? `Уже последняя версия${r.version ? ` (${r.version})` : ""}` : `Уже последняя версия — но нужно: ${ACTION_TEXT[r.pending]}`;
        case "updated": return `Обновлено (${r.version}) — ${ACTION_TEXT[r.pending]}`;
    }
}

export function CheckNowButton() {
    const [busy, setBusy] = useState(false);
    return (
        <Button disabled={busy} onClick={async () => {
            setBusy(true);
            try {
                const r = await checkNow();
                showToast(resultText(r), r.status === "error" ? Toasts.Type.FAILURE : Toasts.Type.SUCCESS);
            } finally {
                setBusy(false);
            }
        }}>
            {busy ? "Проверяю…" : "Проверить обновление"}
        </Button>
    );
}
