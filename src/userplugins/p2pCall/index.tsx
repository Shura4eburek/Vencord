/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { showNotification } from "@api/Notifications";
import definePlugin, { IconProps } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, createRoot, SelectedChannelStore, showToast, Toasts, useEffect, UserStore, useState } from "@webpack/common";

import { CallController } from "./controller";
import { settings } from "./settings";
import { CallPanel } from "./ui/CallPanel";

const VoiceActions = findByPropsLazy("selectVoiceChannel", "selectChannel");

let controller: CallController | null = null;
let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement | null = null;

function PhoneIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="currentColor">
            <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8Z" />
            <path d="M15 3h6v6h-2V6.4l-4.3 4.3-1.4-1.4L17.6 5H15V3Z" />
        </svg>
    );
}

const CallButton: ChatBarButtonFactory = ({ channel, isMainChat }) => {
    const [up, setUp] = useState(controller?.view.relaysUp ?? 0);
    useEffect(() => controller?.subscribe(() => setUp(controller?.view.relaysUp ?? 0)), []);
    if (!isMainChat || !channel.isDM() || !controller) return null;
    const peerId = channel.recipients[0];
    return (
        <ChatBarButton
            tooltip={up ? "P2P-звонок (Shift+клик — с видео)" : "P2P-звонок: нет связи с сигналингом"}
            onClick={e => { if (up) controller?.dial(channel.id, peerId, e.shiftKey); }}
            buttonProps={{ style: { opacity: up ? 1 : 0.4 } }}
        >
            <PhoneIcon />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "P2PCall",
    description: "Прямые звонки в ЛС (голос, камера, экран) без серверов Discord. Нужен у обоих собеседников.",
    authors: [{ name: "Mamoru", id: 0n }],
    settings,

    chatBarButton: { icon: PhoneIcon, render: CallButton },

    start() {
        const self = UserStore.getCurrentUser();
        controller = new CallController(self.id, {
            offerFallback: channelId => showNotification({
                title: "P2P-звонок не удался",
                body: "Нажми, чтобы позвонить через Discord",
                onClick: () => VoiceActions.selectVoiceChannel(channelId),
            }),
            warn: text => showToast(text, Toasts.Type.FAILURE),
            inVoiceChannel: () => !!SelectedChannelStore.getVoiceChannelId(),
            dmPeers: () => ChannelStore.getSortedPrivateChannels()
                .filter(c => c.isDM() && c.recipients.length === 1)
                .map(c => ({ channelId: c.id, peerId: c.recipients[0] })),
        });
        controller.start();

        host = document.createElement("div");
        host.id = "vc-p2pcall-root";
        document.body.appendChild(host);
        root = createRoot(host);
        root.render(<CallPanel c={controller} />);
    },

    stop() {
        controller?.stop();
        controller = null;
        root?.unmount();
        root = null;
        host?.remove();
        host = null;
    },
});
