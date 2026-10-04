/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useRef, UserStore, useState } from "@webpack/common";

import type { CallController, View } from "../controller";
import { settings } from "../settings";
import type { EndReason } from "../state";
import type { PathType } from "../stats";
import { pickSource } from "./SourcePicker";

const END_TEXT: Record<EndReason, string> = {
    "hangup": "Звонок завершён",
    "remote-hangup": "Собеседник завершил звонок",
    "declined": "Звонок отклонён",
    "busy": "Собеседник занят",
    "no-answer": "Нет ответа",
    "ice-timeout": "Прямое соединение не установилось",
    "ice-failed": "Соединение потеряно",
};
const PATH_TEXT: Record<PathType, string> = { host: "напрямую (LAN)", srflx: "напрямую", relay: "через ретранслятор", unknown: "…" };

function useView(c: CallController): View {
    const [v, setV] = useState(c.view);
    useEffect(() => c.subscribe(() => setV(c.view)), [c]);
    return v;
}

function Video({ stream, muted, className, onDoubleClick }: { stream: MediaStream; muted?: boolean; className: string; onDoubleClick?(e: React.MouseEvent<HTMLVideoElement>): void; }) {
    const ref = useRef<HTMLVideoElement>(null);
    useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
    return <video ref={ref} className={className} autoPlay playsInline muted={muted} onDoubleClick={onDoubleClick} />;
}

export function CallPanel({ c }: { c: CallController; }) {
    const v = useView(c);
    const [pos, setPos] = useState({ x: 24, y: 24 });
    const [compact, setCompact] = useState(false);
    const { call } = v;
    if (call.phase === "idle") return null;

    const user = UserStore.getUser(call.peerId);
    const name = user?.globalName ?? user?.username ?? call.peerId;

    const onDrag = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest("button, video")) return;
        const sx = e.clientX - pos.x, sy = e.clientY - pos.y;
        const move = (m: MouseEvent) => setPos({ x: m.clientX - sx, y: m.clientY - sy });
        const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    };

    const main = v.remote.screen ?? v.remote.cam;
    const self = v.local.cam ?? v.local.screen;
    const fullscreen = (e: React.MouseEvent<HTMLVideoElement>) => { e.currentTarget.requestFullscreen?.(); };

    return (
        <div className="p2p-panel" style={{ left: pos.x, top: pos.y }} onMouseDown={onDrag}>
            <div className="p2p-head">
                <span className="p2p-title">{name}</span>
                <button className="p2p-icon" onClick={() => setCompact(!compact)}>{compact ? "▢" : "–"}</button>
            </div>

            {call.phase === "incoming" && (
                <div className="p2p-row">
                    <span>Входящий P2P-звонок{call.video ? " с видео" : ""}</span>
                    <button className="p2p-btn p2p-ok" onClick={() => c.accept()}>Принять</button>
                    <button className="p2p-btn p2p-no" onClick={() => c.decline()}>Отклонить</button>
                </div>
            )}
            {call.phase === "outgoing" && (
                <div className="p2p-row">
                    <span>Вызов…</span>
                    <button className="p2p-btn p2p-no" onClick={() => c.hangup()}>Отмена</button>
                </div>
            )}
            {call.phase === "connecting" && (
                <div className="p2p-row">
                    <span>Соединение…</span>
                    <button className="p2p-btn p2p-no" onClick={() => c.hangup()}>Отмена</button>
                </div>
            )}
            {call.phase === "ended" && <div className="p2p-row">{END_TEXT[call.reason]}</div>}

            {call.phase === "connected" && (
                <>
                    {!compact && (main || self) && (
                        <div className="p2p-stage">
                            {main && <Video stream={main} className="p2p-main" onDoubleClick={fullscreen} />}
                            {self && <Video stream={self} muted className="p2p-self" />}
                        </div>
                    )}
                    <div className="p2p-row">
                        <button className="p2p-icon" title="Микрофон" onClick={() => c.toggleMic()}>{v.local.mic ? "🎤" : "🔇"}</button>
                        <button className="p2p-icon" title="Камера" onClick={() => c.toggleCam()}>{v.local.cam ? "📷" : "🚫📷"}</button>
                        <button className="p2p-icon" title="Экран" onClick={() => v.local.screen ? c.stopScreen() : pickSource(id => c.startScreen(id))}>{v.local.screen ? "⏹️" : "🖥️"}</button>
                        {v.local.screen && (
                            <button className="p2p-btn" onClick={() => c.setHint(v.hint === "motion" ? "detail" : "motion")}>
                                {v.hint === "motion" ? "Плавность" : "Чёткость"}
                            </button>
                        )}
                        <button className="p2p-icon p2p-no" title="Сбросить" onClick={() => c.hangup()}>📞</button>
                    </div>
                    {settings.store.showStats && v.stats && (
                        <div className="p2p-stats">
                            {v.stats.rttMs ?? "—"} мс · потери {v.stats.lossPct}% · ↓{v.stats.inKbps} ↑{v.stats.outKbps} кбит/с · {PATH_TEXT[v.stats.path]}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
