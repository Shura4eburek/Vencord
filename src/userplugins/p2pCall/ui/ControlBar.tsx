/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classes } from "@utils/misc";
import { useEffect, useState } from "@webpack/common";

import type { CallController, View } from "../controller";
import { openAddMenu, openDeviceMenu } from "./DeviceMenu";
import { AddUserIcon, CameraIcon, CameraOffIcon, ChevronDownIcon, FullscreenIcon, HangupIcon, MicIcon, MicOffIcon, ScreenIcon, ScreenOffIcon } from "./icons";
import { pickSource } from "./SourcePicker";
import { StreamQualityPopover } from "./StreamQualityMenu";
import { TipButton } from "./TipButton";

const Ctrl = ({ className, ...p }: { tip: string; className?: string; onClick(e: React.MouseEvent): void; children: React.ReactNode; }) =>
    <TipButton {...p} className={classes("p2p-ctrl", className)} />;

/** Нижняя панель звонка как у Discord (specs/005-call-redesign US3, contracts/ui.md) */
export function ControlBar({ c, v, full, setFull }: { c: CallController; v: View; full: boolean; setFull(f: boolean): void; }) {
    const [quality, setQuality] = useState(false);
    const connected = v.call.phase === "connected";
    const { mic, cam, screen } = v.local;
    // демка кончилась сама (закрыли окно) — поповер не должен открыться при следующей
    useEffect(() => { if (!screen) setQuality(false); }, [screen]);

    /**
     * На весь экран уходит всё окно, а область растягивается поверх: меню устройств и тултипы Discord
     * рисуются в своих слоях вне области и при полноэкранной области были бы не видны
     */
    const toggleFull = () => {
        if (full) { setFull(false); if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); return; }
        setFull(true);
        document.documentElement.requestFullscreen().catch(() => { });
    };

    return (
        <div className="p2p-controls">
            <div className="p2p-controls-left">
                {connected && (
                    <Ctrl tip="Добавить в звонок" className="p2p-ctrl-sm" onClick={e => openAddMenu(e, c)}>
                        <AddUserIcon />
                    </Ctrl>
                )}
            </div>
            <div className="p2p-controls-center">
                {connected && <>
                    <div className="p2p-ctrl-group">
                        <Ctrl tip={cam ? "Выключить камеру" : "Включить камеру"} onClick={() => c.toggleCam()}>
                            {cam ? <CameraIcon /> : <CameraOffIcon />}
                        </Ctrl>
                        <Ctrl tip="Выбрать камеру" className="p2p-ctrl-chevron" onClick={e => openDeviceMenu(e, c, "video")}>
                            <ChevronDownIcon width={16} height={16} />
                        </Ctrl>
                    </div>
                    <div className="p2p-popover-anchor">
                        <Ctrl tip={screen ? "Качество и остановка демонстрации" : "Демонстрация экрана"} className={screen ? "p2p-ctrl-on" : undefined}
                            onClick={() => screen ? setQuality(!quality) : pickSource((id, q) => c.startScreen(id, q))}>
                            {screen ? <ScreenOffIcon /> : <ScreenIcon />}
                        </Ctrl>
                        {quality && screen && <StreamQualityPopover c={c} quality={v.screenQuality} onClose={() => setQuality(false)} />}
                    </div>
                    <div className={classes("p2p-ctrl-group", !mic && "p2p-ctrl-off")}>
                        <Ctrl tip={mic ? "Выключить микрофон" : "Включить микрофон"} onClick={() => c.toggleMic()}>
                            {mic ? <MicIcon /> : <MicOffIcon />}
                        </Ctrl>
                        <Ctrl tip="Устройства ввода и вывода" className="p2p-ctrl-chevron" onClick={e => openDeviceMenu(e, c, "audio")}>
                            <ChevronDownIcon width={16} height={16} />
                        </Ctrl>
                    </div>
                </>}
                <Ctrl tip="Отключиться" className="p2p-ctrl-danger" onClick={() => c.hangup()}>
                    <HangupIcon />
                </Ctrl>
            </div>
            <div className="p2p-controls-right">
                <Ctrl tip={full ? "Выйти из полноэкранного режима" : "На весь экран"} className="p2p-ctrl-sm" onClick={toggleFull}>
                    <FullscreenIcon />
                </Ctrl>
            </div>
        </div>
    );
}
