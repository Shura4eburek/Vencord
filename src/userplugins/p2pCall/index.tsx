/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { showNotification } from "@api/Notifications";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import type { Channel } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, SelectedChannelStore, showToast, Toasts, UserStore } from "@webpack/common";

import { CallController } from "./controller";
import { CALL_AREA_PATCH, HEADER_PATCH, PANEL_PATCH } from "./patches";
import { settings } from "./settings";
import { CallAreaSlot } from "./ui/CallArea";
import { ConnectedPanel } from "./ui/ConnectedPanel";
import { HeaderCallButton } from "./ui/HeaderCallButton";
import { openIncomingCall } from "./ui/IncomingCallModal";

const VoiceActions = findByPropsLazy("selectVoiceChannel", "selectChannel");

let controller: CallController | null = null;

export default definePlugin({
    name: "P2PCall",
    description: "Прямые звонки в ЛС (голос, камера, экран) без серверов Discord. Нужен у обоих собеседников.",
    authors: [{ name: "Mamoru", id: 0n }],
    settings,
    patches: [HEADER_PATCH, CALL_AREA_PATCH, PANEL_PATCH],

    renderHeaderButton(channel: Channel | undefined, HeaderBar: any) {
        if (!controller || !channel?.isDM() || channel.recipients?.length !== 1) return null;
        return (
            <ErrorBoundary noop>
                <HeaderCallButton c={controller} channel={channel} HeaderBar={HeaderBar} />
            </ErrorBoundary>
        );
    },

    renderCallArea(channel: Channel | undefined, height: number) {
        if (!controller || !channel?.isDM()) return null;
        return (
            <ErrorBoundary noop>
                <CallAreaSlot c={controller} channel={channel} height={height} />
            </ErrorBoundary>
        );
    },

    PanelWrapper({ P2POriginal, ...props }: { P2POriginal: React.ComponentType<any>; [k: string]: any; }) {
        return (
            <>
                {controller && (
                    <ErrorBoundary noop>
                        <ConnectedPanel c={controller} />
                    </ErrorBoundary>
                )}
                <P2POriginal {...props} />
            </>
        );
    },

    start() {
        const c = new CallController(UserStore.getCurrentUser().id, {
            offerFallback: channelId => showNotification({
                title: "P2P-звонок не удался",
                body: "Нажми, чтобы позвонить через Discord",
                onClick: () => VoiceActions.selectVoiceChannel(channelId),
            }),
            warn: text => showToast(text, Toasts.Type.FAILURE),
            info: text => showToast(text, Toasts.Type.MESSAGE),
            onIncoming: () => openIncomingCall(c),
            inVoiceChannel: () => !!SelectedChannelStore.getVoiceChannelId(),
            dmPeers: () => ChannelStore.getSortedPrivateChannels()
                .filter(ch => ch.isDM() && ch.recipients.length === 1)
                .map(ch => ({ channelId: ch.id, peerId: ch.recipients[0] })),
        });
        controller = c;
        c.start();
    },

    stop() {
        controller?.stop();
        controller = null;
    },
});
