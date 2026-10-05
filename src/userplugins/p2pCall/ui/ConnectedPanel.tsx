/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavigationRouter, Tooltip, UserStore } from "@webpack/common";

import type { CallController } from "../controller";
import { PATH_TEXT } from "./CallArea";
import { CameraIcon, CameraOffIcon, HangupIcon, ScreenIcon, ScreenOffIcon } from "./icons";
import { pickSource } from "./SourcePicker";
import { useCallView } from "./useCallView";

export function ConnectedPanel({ c }: { c: CallController; }) {
    const v = useCallView(c);
    const { call } = v;
    if (call.phase !== "connecting" && call.phase !== "connected") return null;
    const user = UserStore.getUser(call.peerId);
    const name = user?.globalName ?? user?.username ?? call.peerId;
    const connected = call.phase === "connected";

    return (
        <div className="p2p-plaque">
            <div className="p2p-plaque-info">
                <div className={connected ? "p2p-plaque-status" : "p2p-plaque-status p2p-plaque-wait"}>
                    {connected ? "P2P подключено" : "P2P соединение…"}
                </div>
                <button className="p2p-plaque-peer" onClick={() => NavigationRouter.transitionTo(`/channels/@me/${call.channelId}`)}>
                    {name}{connected && v.stats ? ` · ${v.stats.rttMs ?? "—"} мс · ${PATH_TEXT[v.stats.path]}` : ""}
                </button>
            </div>
            <div className="p2p-plaque-buttons">
                {connected && <>
                    <Tooltip text={v.local.cam ? "Выключить камеру" : "Включить камеру"}>
                        {p => <button {...p} className="p2p-plaque-btn" onClick={() => c.toggleCam()}>{v.local.cam ? <CameraIcon width={20} height={20} /> : <CameraOffIcon width={20} height={20} />}</button>}
                    </Tooltip>
                    <Tooltip text={v.local.screen ? "Остановить демонстрацию" : "Показать экран"}>
                        {p => <button {...p} className="p2p-plaque-btn" onClick={() => v.local.screen ? c.stopScreen() : pickSource(id => c.startScreen(id))}>{v.local.screen ? <ScreenOffIcon width={20} height={20} /> : <ScreenIcon width={20} height={20} />}</button>}
                    </Tooltip>
                </>}
                <Tooltip text="Отключиться">
                    {p => <button {...p} className="p2p-plaque-btn p2p-plaque-hangup" onClick={() => c.hangup()}><HangupIcon width={20} height={20} /></button>}
                </Tooltip>
            </div>
        </div>
    );
}
