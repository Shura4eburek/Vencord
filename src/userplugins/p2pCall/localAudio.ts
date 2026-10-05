/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface LocalAudio { mic: boolean; deafened: boolean; micBeforeDeafen: boolean; }

export const INITIAL_AUDIO: LocalAudio = { mic: true, deafened: false, micBeforeDeafen: true };

/** Как в Discord: включить микрофон в deafen — значит снять deafen */
export function toggleMicState(a: LocalAudio): LocalAudio {
    if (a.deafened) return { mic: true, deafened: false, micBeforeDeafen: true };
    return { ...a, mic: !a.mic };
}

export function toggleDeafenState(a: LocalAudio): LocalAudio {
    if (a.deafened) return { mic: a.micBeforeDeafen, deafened: false, micBeforeDeafen: a.micBeforeDeafen };
    return { mic: false, deafened: true, micBeforeDeafen: a.mic };
}
