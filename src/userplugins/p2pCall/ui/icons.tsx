/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IconProps } from "@utils/types";

type P = IconProps & { size?: string; color?: string; };

// paths — функция: JSX нельзя создавать при загрузке модуля, глобального Vencord ещё нет
function svg(paths: () => React.ReactNode) {
    return ({ width = 24, height = 24, className, color }: P) => (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill={color && color !== "currentColor" ? color : "currentColor"} aria-hidden="true">
            {paths()}
        </svg>
    );
}

const PHONE = "M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8Z";

/** Трубка + звено цепи в правом верхнем углу */
export const PhoneLinkIcon = svg(() => <>
    <path d={PHONE} />
    <path d="M14.6 3.2a2.6 2.6 0 0 1 3.7 0l.3.3.9-.9a2.6 2.6 0 1 1 3.7 3.7l-1.6 1.6a2.6 2.6 0 0 1-3.7 0l-.4-.4 1.1-1.1.4.4c.4.4.9.4 1.3 0l1.6-1.6a.9.9 0 0 0-1.3-1.3l-.9.9.2.2-1.1 1.1-1.5-1.5a.9.9 0 0 0-1.3 0l-1.6 1.6a.9.9 0 0 0 0 1.3l.4.4-1.1 1.1-.4-.4a2.6 2.6 0 0 1 0-3.7l1.3-1.7Z" />
</>);

export const MicIcon = svg(() => <path d="M12 2a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V6a4 4 0 0 0-4-4Zm-7 9a1 1 0 0 1 1 1 6 6 0 0 0 12 0 1 1 0 1 1 2 0 8 8 0 0 1-7 7.9V22h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.1A8 8 0 0 1 4 12a1 1 0 0 1 1-1Z" />);
export const MicOffIcon = svg(() => <path d="M2.7 2.3a1 1 0 0 0-1.4 1.4l18 18a1 1 0 0 0 1.4-1.4l-3.5-3.5A7.9 7.9 0 0 0 20 12a1 1 0 1 0-2 0c0 1.3-.4 2.5-1.1 3.5l-1.4-1.4c.3-.6.5-1.3.5-2.1V6a4 4 0 0 0-7.8-1.2L2.7 2.3ZM8 11.3V12a4 4 0 0 0 5.1 3.9L8 11.3Zm-2 .7a1 1 0 1 0-2 0 8 8 0 0 0 7 7.9V22H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.1c.9-.1 1.7-.4 2.5-.8l-1.5-1.5A6 6 0 0 1 6 12Z" />);
export const HeadphonesIcon = svg(() => <path d="M12 3a9 9 0 0 0-9 9v6a3 3 0 0 0 3 3h1a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H5a7 7 0 0 1 14 0h-2a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1a3 3 0 0 0 3-3v-6a9 9 0 0 0-9-9Z" />);
export const HeadphonesOffIcon = svg(() => <path d="M2.7 2.3a1 1 0 0 0-1.4 1.4l18 18a1 1 0 0 0 1.4-1.4l-1-1A3 3 0 0 0 21 18v-6a9 9 0 0 0-14.8-6.9L2.7 2.3ZM7.6 6.5A7 7 0 0 1 19 12h-2a2 2 0 0 0-2 2v1.9L7.6 6.5ZM3 12c0-1.4.3-2.7.9-3.9l1.5 1.5A7 7 0 0 0 5 12h2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6a3 3 0 0 1-3-3v-5Z" />);
export const CameraIcon = svg(() => <path d="M4 5a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1.4l4.4 2.9A1 1 0 0 0 23 16.7V7.3a1 1 0 0 0-1.6-.8L17 9.4V8a3 3 0 0 0-3-3H4Z" />);
export const CameraOffIcon = svg(() => <path d="M2.7 2.3a1 1 0 0 0-1.4 1.4l18 18a1 1 0 0 0 1.4-1.4l-3.1-3.1.4-.2 4.4 2.9a1 1 0 0 0 1.6-.8V7.3a1 1 0 0 0-1.6-.8L17 9.4V8a3 3 0 0 0-3-3H5.4L2.7 2.3ZM1 8c0-.8.3-1.5.8-2l12.9 13H4a3 3 0 0 1-3-3V8Z" />);
export const ScreenIcon = svg(() => <path d="M4 3a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h7v2H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2h7a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3H4Zm8 3.6 4.2 4.1h-3v3.6h-2.4v-3.6h-3L12 6.6Z" />);
export const ScreenOffIcon = svg(() => <path d="M4 3a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h7v2H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2h7a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3H4Zm5 4h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z" />);
export const HangupIcon = svg(() => <path d="M12 8c-3.7 0-7.2 1.2-9.6 3.2-.5.4-.5 1.1-.1 1.6l2 2.2c.4.4 1 .5 1.5.2l2.4-1.4c.4-.2.6-.6.6-1.1v-1.6a12 12 0 0 1 6.4 0v1.6c0 .5.2.9.6 1.1l2.4 1.4c.5.3 1.1.2 1.5-.2l2-2.2c.4-.5.4-1.2-.1-1.6C19.2 9.2 15.7 8 12 8Z" />);
