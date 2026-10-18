/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classes } from "@utils/misc";
import { NavigationRouter, Tooltip } from "@webpack/common";

import type { CallController } from "../controller";
import { PATH_TEXT } from "./CallArea";
import { CameraIcon, HangupIcon, HeadphonesIcon, HeadphonesOffIcon, ScreenIcon, SignalIcon } from "./icons";
import { nameOf } from "./names";
import { pickSource } from "./SourcePicker";
import { TipButton } from "./TipButton";
import { useCallView } from "./useCallView";

/** «Имя», «Имя / Имя2», «Имя / Имя2 и ещё N» */
function membersText(ids: string[]) {
    const [a, b, ...rest] = ids.map(nameOf);
    if (!b) return a ?? "";
    return rest.length ? `${a} / ${b} и ещё ${rest.length}` : `${a} / ${b}`;
}

/** Плашка над панелью пользователя, как «Voice connected» у Discord (specs/005-call-redesign US4) */
export function ConnectedPanel({ c }: { c: CallController; }) {
    const v = useCallView(c);
    const { call } = v;
    if (call.phase !== "outgoing" && call.phase !== "connecting" && call.phase !== "connected") return null;
    const connected = call.phase === "connected";
    const ids = v.members.length ? v.members.map(m => m.userId) : [call.peerId];
    const status = connected ? "P2P подключено" : call.phase === "outgoing" ? "P2P · вызов…" : "P2P · соединение…";
    const statsTip = connected && v.stats ? `${v.stats.rttMs ?? "—"} мс · ${PATH_TEXT[v.stats.path]}` : status;

    return (
        <div className="p2p-panel">
            <div className="p2p-panel-row">
                <div className="p2p-panel-info">
                    <Tooltip text={statsTip}>
                        {p => (
                            <div {...p} className={classes("p2p-panel-status", !connected && "p2p-pending")}>
                                <SignalIcon width={16} height={16} />{status}
                            </div>
                        )}
                    </Tooltip>
                    <button className="p2p-panel-sub" onClick={() => NavigationRouter.transitionTo(`/channels/@me/${call.channelId}`)}>
                        {membersText(ids)}
                    </button>
                </div>
                <TipButton tip={v.deafened ? "Включить звук" : "Выключить звук"} className="p2p-icon-btn" onClick={() => c.toggleDeafen()}>
                    {v.deafened ? <HeadphonesOffIcon width={20} height={20} /> : <HeadphonesIcon width={20} height={20} />}
                </TipButton>
                <TipButton tip="Отключиться" className="p2p-icon-btn p2p-danger" onClick={() => c.hangup()}>
                    <HangupIcon width={20} height={20} />
                </TipButton>
            </div>
            {connected && (
                <div className="p2p-panel-actions">
                    <button className={classes("p2p-panel-btn", v.local.cam && "p2p-active")} onClick={() => c.toggleCam()}>
                        <CameraIcon width={20} height={20} />Видео
                    </button>
                    <button className={classes("p2p-panel-btn", v.local.screen && "p2p-active")}
                        onClick={() => v.local.screen ? c.stopScreen() : pickSource((id, q) => c.startScreen(id, q))}>
                        <ScreenIcon width={20} height={20} />Экран
                    </button>
                </div>
            )}
        </div>
    );
}
