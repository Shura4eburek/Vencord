/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { DEFAULT_QUALITY, sanitizeQuality, StreamQuality } from "./streamQuality";
import { DeviceSelect } from "./ui/DeviceSelect";
import { CheckNowButton } from "./updater";

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
    screenCodec: {
        type: OptionType.SELECT, description: "Кодек демки",
        options: [
            { label: "Авто (лучший аппаратный у обоих)", value: "auto", default: true },
            { label: "AV1", value: "video/AV1" },
            { label: "H.264", value: "video/H264" },
            { label: "VP9", value: "video/VP9" },
        ],
    },
    diagLog: { type: OptionType.BOOLEAN, description: "Писать статистику звонка в лог Discord (раз в 5 с)", default: true },
    screenHeight: { type: OptionType.NUMBER, description: "", default: DEFAULT_QUALITY.height, hidden: true },
    screenFps: { type: OptionType.NUMBER, description: "", default: DEFAULT_QUALITY.fps, hidden: true },
    screenMaxMbps: { type: OptionType.NUMBER, description: "", default: DEFAULT_QUALITY.maxMbps, hidden: true },
    screenPrefer: { type: OptionType.STRING, description: "", default: DEFAULT_QUALITY.prefer, hidden: true },
    autoUpdate: { type: OptionType.BOOLEAN, description: "Автообновление плагина из релизов GitHub", default: true },
    checkUpdate: {
        type: OptionType.COMPONENT, description: "Проверить обновление сейчас",
        component: () => <CheckNowButton />,
    },
    showStats: { type: OptionType.BOOLEAN, description: "Показывать пинг, потери и тип канала", default: true },
});

export const relayList = () => settings.store.relays.split(",").map(s => s.trim()).filter(Boolean);

export const savedQuality = (): StreamQuality => sanitizeQuality({
    height: settings.store.screenHeight,
    fps: settings.store.screenFps,
    maxMbps: settings.store.screenMaxMbps,
    prefer: settings.store.screenPrefer,
});

export function saveQuality(q: StreamQuality) {
    settings.store.screenHeight = q.height;
    settings.store.screenFps = q.fps;
    settings.store.screenMaxMbps = q.maxMbps;
    settings.store.screenPrefer = q.prefer;
}
