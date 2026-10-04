/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { DeviceSelect } from "./ui/DeviceSelect";

export const DEFAULT_RELAYS = "wss://relay.damus.io, wss://nos.lol, wss://nostr.mom";

export const settings = definePluginSettings({
    relays: { type: OptionType.STRING, description: "Релеи Nostr через запятую (новые заработают после перезапуска Discord)", default: DEFAULT_RELAYS },
    inputDevice: {
        type: OptionType.COMPONENT, description: "Микрофон", default: "default",
        component: ({ setValue }) => <DeviceSelect kind="audioinput" value={settings.store.inputDevice} onChange={setValue} />,
    },
    outputDevice: {
        type: OptionType.COMPONENT, description: "Устройство вывода", default: "default",
        component: ({ setValue }) => <DeviceSelect kind="audiooutput" value={settings.store.outputDevice} onChange={setValue} />,
    },
    cameraDevice: {
        type: OptionType.COMPONENT, description: "Камера", default: "default",
        component: ({ setValue }) => <DeviceSelect kind="videoinput" value={settings.store.cameraDevice} onChange={setValue} />,
    },
    ringTimeoutSec: { type: OptionType.NUMBER, description: "Сколько ждать ответа, с", default: 30 },
    iceTimeoutSec: { type: OptionType.NUMBER, description: "Сколько ждать прямого соединения, с", default: 10 },
    screenMaxBitrateMbps: { type: OptionType.NUMBER, description: "Максимальный битрейт стрима экрана, Мбит/с", default: 8 },
    showStats: { type: OptionType.BOOLEAN, description: "Показывать пинг, потери и тип канала", default: true },
});

export const relayList = () => settings.store.relays.split(",").map(s => s.trim()).filter(Boolean);
