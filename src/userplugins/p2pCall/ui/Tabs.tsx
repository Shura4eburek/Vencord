/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classes } from "@utils/misc";
import { findStoreLazy } from "@webpack";
import { useStateFromStores, VoiceStateStore } from "@webpack/common";

import type { CallController } from "../controller";
import type { Tab } from "../tabs";
import { MicIcon } from "./icons";
import { useCallView } from "./useCallView";

const SpeakingStore = findStoreLazy("SpeakingStore") as { isSpeaking(userId: string): boolean; };

interface Indicator { count: number; speaking: boolean; }

/** Участники и речь в звонке Discord этого ЛС — для индикатора на его вкладке (R3) */
function useDiscordIndicator(channelId: string): Indicator {
    return useStateFromStores([VoiceStateStore, SpeakingStore as any], () => {
        const ids = Object.keys(VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {});
        return { count: ids.length, speaking: ids.some(id => SpeakingStore.isSpeaking(id)) };
    }, [channelId], (a, b) => a.count === b.count && a.speaking === b.speaking);
}

function TabButton({ active, label, ind, onClick }: { active: boolean; label: string; ind: Indicator; onClick(): void; }) {
    return (
        <button className={classes("p2p-tab", active && "p2p-tab-active")} role="tab" aria-selected={active} onClick={onClick}>
            {label}
            <span className="p2p-tab-ind">
                <span className="p2p-dot" />
                {ind.count > 0 && ind.count}
                {ind.speaking && <MicIcon width={12} height={12} />}
            </span>
        </button>
    );
}

/** «Звонок Discord / P2P»: одна область вместо двух (specs/005-call-redesign US1) */
export function Tabs({ c, channelId, active, onPick, float }: { c: CallController; channelId: string; active: Tab; onPick(t: Tab): void; float?: boolean; }) {
    const v = useCallView(c);
    const discord = useDiscordIndicator(channelId);
    const p2p: Indicator = { count: v.members.length + 1, speaking: v.speaking.self || v.members.some(m => m.speaking) };
    return (
        <div className={classes("p2p-tabs", float && "p2p-tabs-float")} role="tablist">
            <TabButton active={active === "discord"} label="Звонок Discord" ind={discord} onClick={() => onPick("discord")} />
            <TabButton active={active === "p2p"} label="P2P" ind={p2p} onClick={() => onPick("p2p")} />
        </div>
    );
}
