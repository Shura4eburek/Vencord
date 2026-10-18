/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classes } from "@utils/misc";
import { Tooltip, useEffect, UserStore, useState } from "@webpack/common";

import type { CallController, MemberView, View } from "../controller";
import { videoLabel } from "../diagLog";
import { settings } from "../settings";
import { EndReason } from "../state";
import type { PathType } from "../stats";
import { ControlBar } from "./ControlBar";
import { FocusIcon, GridIcon, PhoneIcon } from "./icons";
import { nameOf } from "./names";
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
export const PATH_TEXT: Record<PathType, string> = { host: "напрямую (LAN)", srflx: "напрямую", relay: "через ретранслятор", tunnel: "напрямую (туннель)", unknown: "…" };

const MIN_H = 200;
const DEFAULT_H = 360;
// высота живёт в памяти плагина до перезапуска
let savedHeight = DEFAULT_H;

function Stats({ v }: { v: View; }) {
    const s = v.stats;
    if (!s) return null;
    return (
        <div className="p2p-stats">
            <div><span className="p2p-stats-ok">{s.rttMs ?? "—"} мс</span> · потери {s.lossPct}% · {PATH_TEXT[s.path]}</div>
            {s.video.out && <div>↑ {videoLabel(s.video.out)} · {Math.round(s.outKbps / 1000)} Мбит/с</div>}
            {s.video.in && <div>↓ {videoLabel(s.video.in)}</div>}
        </div>
    );
}

/** Сводное состояние звонка вместо сетки: вызов, соединение, завершён */
function CallState({ v }: { v: View; }) {
    const { call } = v;
    const peer = call.phase === "idle" ? null : UserStore.getUser(call.peerId);
    const avatar = peer?.getAvatarURL(undefined, 128);
    if (call.phase === "outgoing") return (
        <div className="p2p-state">
            <span className="p2p-avatar p2p-pulse">{avatar && <img src={avatar} alt="" />}</span>
            <div className="p2p-state-title">{nameOf(call.peerId)}</div>
            <div className="p2p-state-sub">Вызов…</div>
        </div>
    );
    if (call.phase === "ended") return (
        <div className="p2p-state">
            <span className="p2p-avatar">{avatar && <img src={avatar} alt="" />}</span>
            <div className="p2p-state-title">{END_TEXT[call.reason]}</div>
        </div>
    );
    return (
        <div className="p2p-state">
            <span className="p2p-avatar">{avatar && <img src={avatar} alt="" />}</span>
            <div className="p2p-state-title">{call.phase === "idle" ? "" : nameOf(call.peerId)}</div>
            <div className="p2p-state-sub"><span className="p2p-spinner" />Соединение…</div>
        </div>
    );
}

/** Область P2P-звонка над чатом ЛС (specs/005-call-redesign US2, contracts/ui.md) */
export function CallArea({ c, height, tabs }: { c: CallController; height: number; tabs?: React.ReactNode; }) {
    const v = useCallView(c);
    const [h, setH] = useState(savedHeight);
    const [full, setFull] = useState(false);
    // Esc или F11 вышли из полноэкранного режима окна — область возвращается на место
    useEffect(() => {
        const on = () => { if (!document.fullscreenElement) setFull(false); };
        document.addEventListener("fullscreenchange", on);
        return () => document.removeEventListener("fullscreenchange", on);
    }, []);
    const [resizing, setResizing] = useState(false);
    // в групповом звонке клик по плитке — она крупно, повторный — обратно к сетке
    const [focus, setFocus] = useState<string | null>(null);
    const { call } = v;
    const maxH = Math.max(MIN_H, Math.round((height || 800) * 0.8));
    const areaH = Math.min(Math.max(h, MIN_H), maxH);
    const selfId = UserStore.getCurrentUser().id;
    const group = v.members.length > 1;

    const onResize = (e: React.PointerEvent) => {
        const startY = e.clientY, startH = areaH;
        setResizing(true);
        const move = (m: PointerEvent) => {
            const next = Math.min(Math.max(startH + m.clientY - startY, MIN_H), maxH);
            savedHeight = next;
            setH(next);
        };
        const up = () => { setResizing(false); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };

    // сетка только когда звонок идёт; вызов, соединение вдвоём и завершение — состояние по центру
    const showGrid = v.inCall ? call.phase !== "ended" : call.phase === "connected";
    const focusOn = group && focus && v.members.some(m => m.userId === focus) ? focus : null;
    const selfVideo = v.local.screen ?? v.local.cam ?? null;
    const title = group ? `Групповой звонок · ${v.members.length + 1}` : call.phase === "idle" ? "" : nameOf(v.members[0]?.userId ?? call.peerId);

    const selfTile = (small?: boolean) => (
        <Tile key={selfId} userId={selfId} video={selfVideo} mirror={!!v.local.cam && !v.local.screen} live={!!v.local.screen} small={small}
            speaking={v.speaking.self} micOff={!v.local.mic} deafened={v.deafened}
            onClick={group ? () => setFocus(focusOn === selfId ? null : selfId) : undefined} />
    );
    const memberTile = (m: MemberView, small?: boolean) => (
        <Tile key={m.userId} userId={m.userId} video={m.remote.screen ?? m.remote.cam ?? null} live={!!m.remote.screen} small={small}
            speaking={m.speaking} micOff={m.micOff} deafened={m.deafened} ringing={m.phase === "outgoing"}
            // в группе связь с участником может не установиться, хотя он в звонке
            noLink={group && m.phase !== "connected" && m.phase !== "outgoing"}
            onClick={group ? () => setFocus(focusOn === m.userId ? null : m.userId) : undefined} />
    );

    let stage: React.ReactNode;
    if (!showGrid) stage = <CallState v={v} />;
    else if (focusOn) {
        const main = focusOn === selfId ? selfTile() : memberTile(v.members.find(m => m.userId === focusOn)!);
        stage = (
            <div className="p2p-focus">
                <div className="p2p-focus-main">{main}</div>
                <div className="p2p-strip">
                    {focusOn !== selfId && selfTile(true)}
                    {v.members.filter(m => m.userId !== focusOn).map(m => memberTile(m, true))}
                </div>
            </div>
        );
    } else stage = (
        <div className="p2p-grid" data-count={v.members.length + 1}>
            {selfTile()}
            {v.members.map(m => memberTile(m))}
        </div>
    );

    return (
        <div className={classes("p2p-area", resizing && "p2p-resizing", full && "p2p-area-full")} style={{ height: areaH }}>
            <div className="p2p-header">
                <div className="p2p-header-left">
                    {tabs}
                    <div className="p2p-title"><PhoneIcon width={20} height={20} /><span>{title}</span></div>
                </div>
                <div className="p2p-header-right">
                    {group && showGrid && (
                        <Tooltip text={focusOn ? "Сетка" : "Фокус"}>
                            {p => (
                                <button {...p} className="p2p-icon-btn" aria-label={focusOn ? "Сетка" : "Фокус"}
                                    onClick={() => setFocus(focusOn ? null : (v.members.find(m => m.remote.screen)?.userId ?? v.members[0].userId))}>
                                    {focusOn ? <GridIcon width={20} height={20} /> : <FocusIcon width={20} height={20} />}
                                </button>
                            )}
                        </Tooltip>
                    )}
                </div>
            </div>
            <div className="p2p-stage">
                {showGrid && call.phase === "connected" && settings.store.showStats && <Stats v={v} />}
                {stage}
            </div>
            {call.phase !== "ended" && <ControlBar c={c} v={v} full={full} setFull={setFull} />}
            <div className="p2p-resize" role="separator" aria-orientation="horizontal" onPointerDown={onResize} />
        </div>
    );
}
