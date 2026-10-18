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
import { upgradeRelays } from "./relay";
import { settings } from "./settings";
import { isActive } from "./state";
import { CallSlot } from "./ui/CallSlot";
import { ConnectedPanel } from "./ui/ConnectedPanel";
import { HeaderCallButton } from "./ui/HeaderCallButton";
import { openIncomingCall } from "./ui/IncomingCallModal";
import { startUpdater, stopUpdater } from "./updater";

const VoiceActions = findByPropsLazy("selectVoiceChannel", "selectChannel");

let controller: CallController | null = null;

export default definePlugin({
    name: "P2PCall",
    description: "Прямые звонки в ЛС (голос, камера, экран) без серверов Discord. Нужен у обоих собеседников.",
    authors: [{ name: "Mamoru", id: 0n }],
    settings,
    patches: [HEADER_PATCH, CALL_AREA_PATCH, PANEL_PATCH],

    flux: {
        // открыт ЛС — обмениваемся ключами с собеседником, если ещё нет контакта
        CHANNEL_SELECT({ channelId }: { channelId?: string; }) {
            if (channelId) controller?.openedChannel(channelId);
        },
    },

    renderHeaderButton(channel: Channel | undefined, HeaderBar: any) {
        if (!controller || !channel?.isDM() || channel.recipients?.length !== 1) return null;
        return (
            <ErrorBoundary noop>
                <HeaderCallButton c={controller} channel={channel} HeaderBar={HeaderBar} />
            </ErrorBoundary>
        );
    },

    /** renderNative — родная область звонка Discord: при любой нашей ошибке рисуется она (specs/005-call-redesign R1) */
    renderCallArea(channel: Channel | undefined, height: number, renderNative: () => React.ReactNode) {
        if (!controller || !channel?.isDM()) return renderNative();
        return (
            <ErrorBoundary fallback={() => <>{renderNative()}</>}>
                <CallSlot c={controller} channel={channel} height={height} renderNative={renderNative} />
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
        settings.store.relays = upgradeRelays(settings.store.relays);
        const c = new CallController(UserStore.getCurrentUser().id, {
            offerFallback: (channelId, hint) => showNotification({
                title: "P2P-звонок не удался",
                body: hint ? `${hint}. Нажми, чтобы позвонить через Discord` : "Нажми, чтобы позвонить через Discord",
                onClick: () => VoiceActions.selectVoiceChannel(channelId),
            }),
            warn: text => showToast(text, Toasts.Type.FAILURE),
            info: text => showToast(text, Toasts.Type.MESSAGE),
            onIncoming: linkId => openIncomingCall(c, linkId),
            inVoiceChannel: () => !!SelectedChannelStore.getVoiceChannelId(),
            dmPeers: () => ChannelStore.getSortedPrivateChannels()
                .filter(ch => ch.isDM() && ch.recipients.length === 1)
                .map(ch => ({ channelId: ch.id, peerId: ch.recipients[0] })),
            profile: userId => {
                const u = UserStore.getUser(userId);
                return { name: u ? (u as any).globalName ?? u.username : userId, avatar: u?.getAvatarURL?.(undefined, 64) ?? null };
            },
            newKey: userId => showNotification({
                title: "Новый ключ P2P",
                body: `У ${UserStore.getUser(userId)?.username ?? userId} новый ключ — новое устройство или подмена. Уточни у собеседника и подтверди в настройках P2PCall`,
                permanent: true,
            }),
        });
        controller = c;
        c.start();
        startUpdater(() => settings.store.autoUpdate, {
            inCall: () => isActive(c.view.call),
            onCallEnd: fn => c.subscribe(() => { if (!isActive(c.view.call)) fn(); }),
        });
    },

    stop() {
        stopUpdater();
        controller?.stop();
        controller = null;
    },
});
