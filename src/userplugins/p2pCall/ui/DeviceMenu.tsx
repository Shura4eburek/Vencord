/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelStore, ContextMenuApi, Menu, useEffect, UserStore, useState } from "@webpack/common";

import type { CallController } from "../controller";
import { settings } from "../settings";
import { nameOf } from "./names";

const ADD_LIMIT = 10;

const label = (d: MediaDeviceInfo, i: number) => d.label || `Устройство ${i + 1}`;

function useDevices() {
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    useEffect(() => { navigator.mediaDevices.enumerateDevices().then(setDevices, () => { }); }, []);
    return devices;
}

function DeviceGroup({ kind, title, devices, c }: { kind: MediaDeviceKind; title: string; devices: MediaDeviceInfo[]; c: CallController; }) {
    const current = kind === "audioinput" ? settings.store.inputDevice : kind === "audiooutput" ? settings.store.outputDevice : settings.store.cameraDevice;
    // «default» у Chromium — тот же выбор по умолчанию, что и пустая строка
    const list = devices.filter(d => d.kind === kind && d.deviceId !== "default" && d.deviceId !== "communications");
    return (
        <Menu.MenuGroup label={title}>
            <Menu.MenuRadioItem id={`p2p-${kind}-default`} group={`p2p-${kind}`} label="По умолчанию"
                checked={!current || current === "default"} action={() => c.setDevice(kind, "")} />
            {list.map((d, i) => (
                <Menu.MenuRadioItem key={d.deviceId} id={`p2p-${kind}-${d.deviceId}`} group={`p2p-${kind}`} label={label(d, i)}
                    checked={current === d.deviceId} action={() => c.setDevice(kind, d.deviceId)} />
            ))}
        </Menu.MenuGroup>
    );
}

function DeviceMenu({ c, what }: { c: CallController; what: "audio" | "video"; }) {
    const devices = useDevices();
    return (
        <Menu.Menu navId="p2p-devices" onClose={ContextMenuApi.closeContextMenu} aria-label="Устройства">
            {what === "audio" ? [
                <DeviceGroup key="in" kind="audioinput" title="Устройство ввода" devices={devices} c={c} />,
                <DeviceGroup key="out" kind="audiooutput" title="Устройство вывода" devices={devices} c={c} />,
                <Menu.MenuGroup key="deaf">
                    <Menu.MenuCheckboxItem id="p2p-deafen" label="Выключить звук" checked={c.view.deafened} action={() => c.toggleDeafen()} />
                </Menu.MenuGroup>,
            ] : <DeviceGroup kind="videoinput" title="Камера" devices={devices} c={c} />}
        </Menu.Menu>
    );
}

/** Шеврон у микрофона или камеры: выбор устройства посреди звонка (specs/005-call-redesign R6). Меню открывается
 *  прямо в обработчике клика — событие ещё живое, а список устройств подгружается уже в открытом меню */
export function openDeviceMenu(e: React.MouseEvent, c: CallController, what: "audio" | "video") {
    ContextMenuApi.openContextMenu(e, () => <DeviceMenu c={c} what={what} />);
}

/** «Добавить в звонок»: последние ЛС один на один — тот же вызов, что кнопка в шапке ЛС */
export function openAddMenu(e: React.MouseEvent, c: CallController) {
    const selfId = UserStore.getCurrentUser().id;
    const candidates = ChannelStore.getSortedPrivateChannels()
        .filter(ch => ch.isDM() && ch.recipients?.length === 1 && ch.recipients[0] !== selfId)
        .filter(ch => !c.view.members.some(m => m.userId === ch.recipients[0]))
        .slice(0, ADD_LIMIT);
    ContextMenuApi.openContextMenu(e, () => (
        <Menu.Menu navId="p2p-add" onClose={ContextMenuApi.closeContextMenu} aria-label="Добавить в звонок">
            <Menu.MenuGroup label="Добавить в звонок">
                {candidates.length ? candidates.map(ch => {
                    const id = ch.recipients[0];
                    const blocked = c.canAdd(id);
                    return (
                        <Menu.MenuItem key={ch.id} id={`p2p-add-${ch.id}`}
                            label={nameOf(id)}
                            subtext={blocked ?? undefined}
                            disabled={!!blocked}
                            action={() => c.dial(ch.id, id, false)} />
                    );
                }) : <Menu.MenuItem id="p2p-add-none" label="Нет собеседников" disabled />}
            </Menu.MenuGroup>
        </Menu.Menu>
    ));
}
