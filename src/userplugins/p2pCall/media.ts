/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

import { captureConstraints, displayMediaConstraints, StreamQuality } from "./streamQuality";

const Native = VencordNative.pluginHelpers.P2PCall as PluginNative<typeof import("./native")>;

const dev = (id: string) => (id && id !== "default" ? { deviceId: { exact: id } } : {});

export function getMic(deviceId: string) {
    return navigator.mediaDevices.getUserMedia({
        audio: { ...dev(deviceId), echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
}

export function getCamera(deviceId: string) {
    return navigator.mediaDevices.getUserMedia({
        video: { ...dev(deviceId), width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
}

/** getDisplayMedia через наш обработчик (стабильные 60 FPS); при отказе — legacy-захват */
export async function getScreen(sourceId: string, q: StreamQuality): Promise<MediaStream> {
    try {
        await Native.prepareDisplayMedia(sourceId);
        return await navigator.mediaDevices.getDisplayMedia({ audio: false, video: displayMediaConstraints(q) });
    } catch (e) {
        console.warn("[P2PCall] getDisplayMedia failed, falling back to legacy capture", e);
    }
    return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
            mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: sourceId,
                ...captureConstraints(q),
            },
        } as MediaTrackConstraints,
    });
}

export function playStream(stream: MediaStream, sinkId: string): HTMLAudioElement {
    const el = new Audio();
    el.autoplay = true;
    el.srcObject = stream;
    if (sinkId && sinkId !== "default") (el as any).setSinkId?.(sinkId).catch(() => { });
    el.play().catch(() => { });
    return el;
}
