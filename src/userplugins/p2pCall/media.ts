/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

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

export function getScreen(sourceId: string) {
    return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
            mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: sourceId,
                maxWidth: 1920,
                maxHeight: 1080,
                maxFrameRate: 60,
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
