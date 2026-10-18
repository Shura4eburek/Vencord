/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IconProps } from "@utils/types";

type P = IconProps & { size?: string; color?: string; };

/** Пути из дизайн-системы «P2P-звонок»: viewBox 0 0 24 24, заливка, правило nonzero (specs/005-call-redesign R9) */
export const PATHS = {
    mic: "M12 2a4 4 0 0 1 4 4v5a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4Z M6 10a1 1 0 0 1 1 1 5 5 0 0 0 10 0 1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V20h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.07A7 7 0 0 1 5 11a1 1 0 0 1 1-1Z",
    micOff: "M12 2a4 4 0 0 1 4 4v5a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4Z M6 10a1 1 0 0 1 1 1 5 5 0 0 0 10 0 1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V20h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.07A7 7 0 0 1 5 11a1 1 0 0 1 1-1Z M2.7 4.1a1 1 0 0 1 1.4-1.4l17.2 17.2a1 1 0 0 1-1.4 1.4L2.7 4.1Z",
    headphones: "M12 3a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h1a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H5a7 7 0 0 1 14 0h-2a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1a3 3 0 0 0 3-3v-5a9 9 0 0 0-9-9Z",
    headphonesOff: "M12 3a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h1a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H5a7 7 0 0 1 14 0h-2a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1a3 3 0 0 0 3-3v-5a9 9 0 0 0-9-9Z M4.1 2.7a1 1 0 0 0-1.4 1.4l17.2 17.2a1 1 0 0 0 1.4-1.4L4.1 2.7Z",
    camera: "M4 6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h9a3 3 0 0 0 3-3V9a3 3 0 0 0-3-3H4Z M17.5 10.2l3.9-2.6A1 1 0 0 1 23 8.4v7.2a1 1 0 0 1-1.6.8l-3.9-2.6v-3.6Z",
    cameraOff: "M4 6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h9a3 3 0 0 0 3-3V9a3 3 0 0 0-3-3H4Z M17.5 10.2l3.9-2.6A1 1 0 0 1 23 8.4v7.2a1 1 0 0 1-1.6.8l-3.9-2.6v-3.6Z M4.1 2.7a1 1 0 0 0-1.4 1.4l17.2 17.2a1 1 0 0 0 1.4-1.4L4.1 2.7Z",
    screen: "M4 3a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h7v2H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2h7a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3H4Z M12 6l4 4h-3v4h-2v-4H8l4-4Z",
    screenStop: "M4 3a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h7v2H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2h7a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3H4Z M9.2 6.3l2.8 2.8 2.8-2.8 1.4 1.4-2.8 2.8 2.8 2.8-1.4 1.4-2.8-2.8-2.8 2.8-1.4-1.4 2.8-2.8-2.8-2.8 1.4-1.4Z",
    hangup: "M9.9 2.5L12 4.6l2.1-2.1 1.4 1.4L13.4 6l2.1 2.1-1.4 1.4L12 7.4 9.9 9.5 8.5 8.1 10.6 6 8.5 3.9l1.4-1.4Z M12 12c-3.6 0-6.9 1.1-9.3 3a1.8 1.8 0 0 0-.6 2l.7 2a1.5 1.5 0 0 0 1.8 1l3.2-.8a1.5 1.5 0 0 0 1.1-1.3l.2-1.9a11 11 0 0 1 5.8 0l.2 1.9a1.5 1.5 0 0 0 1.1 1.3l3.2.8a1.5 1.5 0 0 0 1.8-1l.7-2a1.8 1.8 0 0 0-.6-2C18.9 13.1 15.6 12 12 12Z",
    addUser: "M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M2 19c0-3.3 3.1-6 7-6s7 2.7 7 6v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-1Z M19 5a1 1 0 0 1 1 1v2h2a1 1 0 1 1 0 2h-2v2a1 1 0 1 1-2 0v-2h-2a1 1 0 1 1 0-2h2V6a1 1 0 0 1 1-1Z",
    chevronDown: "M6.3 8.8a1 1 0 0 1 1.4 0L12 13.1l4.3-4.3a1 1 0 1 1 1.4 1.4l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 0 1 0-1.4Z",
    grid: "M3 5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Z M13 5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V5Z M3 15a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4Z M13 15a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4Z",
    focus: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Z M3 18.5A1.5 1.5 0 0 1 4.5 17h3A1.5 1.5 0 0 1 9 18.5v1A1.5 1.5 0 0 1 7.5 21h-3A1.5 1.5 0 0 1 3 19.5v-1Z M10 18.5a1.5 1.5 0 0 1 1.5-1.5h1a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1-1.5 1.5h-1a1.5 1.5 0 0 1-1.5-1.5v-1Z M15 18.5a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1-1.5 1.5h-3a1.5 1.5 0 0 1-1.5-1.5v-1Z",
    fullscreen: "M4 3a1 1 0 0 0-1 1v5a1 1 0 0 0 2 0V5h4a1 1 0 0 0 0-2H4Z M15 3a1 1 0 1 0 0 2h4v4a1 1 0 1 0 2 0V4a1 1 0 0 0-1-1h-5Z M4 14a1 1 0 0 1 1 1v4h4a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z M20 14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 1 1 0-2h4v-4a1 1 0 0 1 1-1Z",
    signal: "M3 17a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3Z M10 12a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-8Z M17 6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V6Z",
    p2pCall: "M6.6 2.6a1.5 1.5 0 0 1 1.7.6l1.6 2.6a1.5 1.5 0 0 1-.2 1.8L8.4 8.9a11 11 0 0 0 6.7 6.7l1.3-1.3a1.5 1.5 0 0 1 1.8-.2l2.6 1.6a1.5 1.5 0 0 1 .6 1.7l-.6 2a2.5 2.5 0 0 1-2.6 1.7C10.6 20.4 3.6 13.4 2.9 5.8a2.5 2.5 0 0 1 1.7-2.6l2-.6Z M14 2h1a3 3 0 0 1 0 6h-1a3 3 0 0 1 0-6Zm0 2a1 1 0 0 0 0 2h1a1 1 0 0 0 0-2h-1Z M19 2h1a3 3 0 0 1 0 6h-1a3 3 0 0 1 0-6Zm0 2a1 1 0 0 0 0 2h1a1 1 0 0 0 0-2h-1Z",
    phone: "M6.6 2.6a1.5 1.5 0 0 1 1.7.6l1.6 2.6a1.5 1.5 0 0 1-.2 1.8L8.4 8.9a11 11 0 0 0 6.7 6.7l1.3-1.3a1.5 1.5 0 0 1 1.8-.2l2.6 1.6a1.5 1.5 0 0 1 .6 1.7l-.6 2a2.5 2.5 0 0 1-2.6 1.7C10.6 20.4 3.6 13.4 2.9 5.8a2.5 2.5 0 0 1 1.7-2.6l2-.6Z",
};

// JSX создаётся только при рендере: при загрузке модуля глобального Vencord ещё нет
function svg(d: string) {
    return ({ width = 24, height = 24, className, color }: P) => (
        // цвет через style: в атрибуте fill var() не работает
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="currentColor" style={color && color !== "currentColor" ? { color } : undefined} aria-hidden="true">
            <path d={d} />
        </svg>
    );
}

export const MicIcon = svg(PATHS.mic);
export const MicOffIcon = svg(PATHS.micOff);
export const HeadphonesIcon = svg(PATHS.headphones);
export const HeadphonesOffIcon = svg(PATHS.headphonesOff);
export const CameraIcon = svg(PATHS.camera);
export const CameraOffIcon = svg(PATHS.cameraOff);
export const ScreenIcon = svg(PATHS.screen);
export const ScreenOffIcon = svg(PATHS.screenStop);
export const HangupIcon = svg(PATHS.hangup);
export const AddUserIcon = svg(PATHS.addUser);
export const ChevronDownIcon = svg(PATHS.chevronDown);
export const GridIcon = svg(PATHS.grid);
export const FocusIcon = svg(PATHS.focus);
export const FullscreenIcon = svg(PATHS.fullscreen);
export const SignalIcon = svg(PATHS.signal);
/** Трубка со звеньями цепи — кнопка P2P-звонка */
export const PhoneLinkIcon = svg(PATHS.p2pCall);
export const PhoneIcon = svg(PATHS.phone);
