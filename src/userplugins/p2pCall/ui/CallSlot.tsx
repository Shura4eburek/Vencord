/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Channel } from "@vencord/discord-types";
import { useEffect, useState } from "@webpack/common";

import type { CallController } from "../controller";
import { areaVisible } from "../state";
import { getPick, pickTab, setPick, Tab, trackSeen } from "../tabs";
import { CallArea } from "./CallArea";
import { Tabs } from "./Tabs";

/**
 * Виден ли P2P-звонок в этом ЛС. Подписка только на это значение: CallSlot рисует и родную область Discord,
 * поэтому не должен перерисовываться на каждый тик статистики и речи P2P-звонка
 */
function useP2PVisible(c: CallController, channelId: string) {
    const check = () => areaVisible(c.view.call, channelId, c.view.channels);
    const [visible, setVisible] = useState(check);
    useEffect(() => {
        setVisible(check());
        return c.subscribe(() => setVisible(check()));
    }, [c, channelId]);
    return visible;
}

/**
 * Место области звонка в ЛС: звонок Discord, P2P-звонок или оба на вкладках (specs/005-call-redesign contracts/ui.md).
 * renderNative — родная область Discord; null, если звонка Discord в этом ЛС нет
 */
export function CallSlot({ c, channel, height, renderNative }: { c: CallController; channel: Channel; height: number; renderNative(): React.ReactNode; }) {
    const p2p = useP2PVisible(c, channel.id);
    // выбор вкладки живёт в модуле (переживает уход из ЛС), счётчик только перерисовывает после клика
    const [, rerender] = useState(0);
    const native = renderNative();
    const hasNative = native != null && native !== false;
    const seen = trackSeen(channel.id, hasNative, p2p);
    const tab = pickTab(seen, getPick(channel.id));
    const pick = (t: Tab) => { setPick(channel.id, t); rerender(n => n + 1); };
    const showNative = hasNative && (!p2p || tab === "discord");

    // позиции детей постоянны: родная область всегда в одной и той же обёртке, иначе React пересоздаёт её
    // (видео Discord начинается заново) при каждом появлении или уходе P2P-звонка
    return (
        <>
            <div className={tab === "discord" ? "p2p-native-wrap" : "p2p-native-plain"}>
                {tab === "discord" && <Tabs c={c} channelId={channel.id} active={tab} onPick={pick} float />}
                {showNative && native}
            </div>
            {p2p && tab !== "discord" && (
                <CallArea c={c} height={height} tabs={tab && <Tabs c={c} channelId={channel.id} active={tab} onPick={pick} />} />
            )}
        </>
    );
}
