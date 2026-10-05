/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classes } from "@utils/misc";
import type { Channel } from "@vencord/discord-types";
import { Tooltip, UserStore, useState } from "@webpack/common";

import type { CallController } from "../controller";
import { settings } from "../settings";
import { areaVisible, EndReason } from "../state";
import type { PathType } from "../stats";
import { CameraIcon, CameraOffIcon, HangupIcon, HeadphonesIcon, HeadphonesOffIcon, MicIcon, MicOffIcon, ScreenIcon, ScreenOffIcon } from "./icons";
import { pickSource } from "./SourcePicker";
import { Tile } from "./Tile";
import { useCallView } from "./useCallView";

export const END_TEXT: Record<EndReason, string> = {
    "hangup": "Звонок завершён",
    "remote-hangup": "Собеседник завершил звонок",
    "declined": "Звонок отклонён",
    "busy": "Собеседник занят",
    "no-answer": "Нет ответа",
    "ice-timeout": "Прямое соединение не установилось",
    "ice-failed": "Соединение потеряно",
};
export const PATH_TEXT: Record<PathType, string> = { host: "напрямую (LAN)", srflx: "напрямую", relay: "через ретранслятор", unknown: "…" };

const MIN_H = 160;
const DEFAULT_H = 300;
// высота живёт в памяти плагина до перезапуска
let savedHeight = DEFAULT_H;

function CtrlButton({ label, active, danger, onClick, children }: { label: string; active?: boolean; danger?: boolean; onClick(): void; children: React.ReactNode; }) {
    return (
        <Tooltip text={label}>
            {props => (
                <button {...props} className={classes("p2p-ctrl", active && "p2p-ctrl-off", danger && "p2p-ctrl-danger")} onClick={onClick} aria-label={label}>
                    {children}
                </button>
            )}
        </Tooltip>
    );
}

export function CallAreaSlot({ c, channel, height }: { c: CallController; channel: Channel | undefined; height: number; }) {
    const v = useCallView(c);
    const [h, setH] = useState(savedHeight);
    const { call } = v;
    // фазы idle/incoming уже отсечены areaVisible, проверка нужна для сужения типа
    if (!channel || call.phase === "idle" || call.phase === "incoming" || !areaVisible(call, channel.id)) return null;
    const maxH = Math.max(MIN_H, (height || 800) - 200);
    const areaH = Math.min(Math.max(h, MIN_H), maxH);
    const selfId = UserStore.getCurrentUser().id;

    const onResize = (e: React.MouseEvent) => {
        const startY = e.clientY, startH = areaH;
        const move = (m: MouseEvent) => {
            const next = Math.min(Math.max(startH + m.clientY - startY, MIN_H), maxH);
            savedHeight = next;
            setH(next);
        };
        const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    };

    const peerVideo = v.remote.screen ?? v.remote.cam ?? null;
    const selfVideo = v.local.screen ?? v.local.cam ?? null;
    const connected = call.phase === "connected";

    let caption: string | null = null;
    if (call.phase === "outgoing") caption = "Вызов…";
    else if (call.phase === "connecting") caption = "Соединение…";
    else if (call.phase === "ended") caption = END_TEXT[call.reason];

    return (
        <div className="p2p-area" style={{ height: areaH }}>
            {connected && settings.store.showStats && v.stats && (
                <div className="p2p-chip">
                    {v.stats.rttMs ?? "—"} мс · потери {v.stats.lossPct}% · {PATH_TEXT[v.stats.path]}
                </div>
            )}
            <div className="p2p-tiles">
                <Tile userId={selfId} video={selfVideo} mirror={!!v.local.cam && !v.local.screen}
                    speaking={v.speaking.self} micOff={!v.local.mic} deafened={v.deafened} />
                <Tile userId={call.peerId} video={peerVideo}
                    speaking={v.speaking.peer} ringing={call.phase === "outgoing"} />
            </div>
            {caption && <div className="p2p-caption">{caption}</div>}
            {call.phase !== "ended" && (
                <div className="p2p-controls">
                    {connected && <>
                        <CtrlButton label={v.local.mic ? "Выключить микрофон" : "Включить микрофон"} active={!v.local.mic} onClick={() => c.toggleMic()}>
                            {v.local.mic ? <MicIcon /> : <MicOffIcon />}
                        </CtrlButton>
                        <CtrlButton label={v.deafened ? "Включить звук" : "Выключить звук"} active={v.deafened} onClick={() => c.toggleDeafen()}>
                            {v.deafened ? <HeadphonesOffIcon /> : <HeadphonesIcon />}
                        </CtrlButton>
                        <CtrlButton label={v.local.cam ? "Выключить камеру" : "Включить камеру"} active={!v.local.cam} onClick={() => c.toggleCam()}>
                            {v.local.cam ? <CameraIcon /> : <CameraOffIcon />}
                        </CtrlButton>
                        <CtrlButton label={v.local.screen ? "Остановить демонстрацию" : "Показать экран"} active={!!v.local.screen}
                            onClick={() => v.local.screen ? c.stopScreen() : pickSource(id => c.startScreen(id))}>
                            {v.local.screen ? <ScreenOffIcon /> : <ScreenIcon />}
                        </CtrlButton>
                        {v.local.screen && (
                            <button className="p2p-hint" onClick={() => c.setHint(v.hint === "motion" ? "detail" : "motion")}>
                                {v.hint === "motion" ? "Плавность" : "Чёткость"}
                            </button>
                        )}
                    </>}
                    <CtrlButton label="Отключиться" danger onClick={() => c.hangup()}>
                        <HangupIcon />
                    </CtrlButton>
                </div>
            )}
            <div className="p2p-resize" onMouseDown={onResize} />
        </div>
    );
}
