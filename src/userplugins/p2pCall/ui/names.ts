/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { UserStore } from "@webpack/common";

/** Имя пользователя в интерфейсе звонка — одно правило для плиток, окон, меню и панели */
export const nameOf = (id: string) => {
    const u = UserStore.getUser(id);
    return u?.globalName ?? u?.username ?? id;
};
