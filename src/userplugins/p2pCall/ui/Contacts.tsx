/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";
import { Button, useEffect, useState } from "@webpack/common";

import type { ContactView } from "../native";

const Native = VencordNative.pluginHelpers.P2PCall as PluginNative<typeof import("../native")>;

/** Контроллер подписывается, чтобы после подтверждения или удаления сразу обновить ключи пар */
export const contactsChanged = new Set<() => void>();

/** Книга контактов: код проверки, «сверен», подтверждение нового ключа, удаление (specs/003-identity-keys US2) */
export function ContactsList() {
    const [list, setList] = useState<ContactView[] | null>(null);
    const reload = () => Native.contactsList().then(setList, () => setList([]));
    useEffect(() => { reload(); }, []);
    const act = (p: Promise<unknown>) => p.then(() => { contactsChanged.forEach(f => f()); reload(); });

    if (!list) return <div className="p2p-contacts-note">Загрузка…</div>;
    if (!list.length) return <div className="p2p-contacts-note">Контактов пока нет — они появятся сами, когда собеседник с P2PCall будет в сети и у вас есть общий ЛС</div>;
    return (
        <div className="p2p-contacts">
            <div className="p2p-contacts-note">Сверь код проверки с собеседником голосом: совпал — ключи настоящие, даже если подменить пытался сам Discord</div>
            {list.map(c => (
                <div key={c.userId} className="p2p-contact">
                    <div className="p2p-contact-head">
                        {c.avatar && <img src={c.avatar} alt="" />}
                        <b>{c.name}</b>
                        <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} look={Button.Looks.LINK} onClick={() => act(Native.contactRemove(c.userId))}>Удалить</Button>
                    </div>
                    {c.devices.map(d => (
                        <div key={d.publicKey} className={"p2p-device" + (d.state === "pending" ? " p2p-device-pending" : "")}>
                            <code>{d.code}</code>
                            {d.state === "pending"
                                ? <>
                                    <span>новый ключ — звонки ждут подтверждения</span>
                                    <Button size={Button.Sizes.SMALL} onClick={() => act(Native.contactConfirm(c.userId, d.publicKey))}>Подтвердить</Button>
                                    <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={() => act(Native.contactRemove(c.userId, d.publicKey))}>Отклонить</Button>
                                </>
                                : <label>
                                    <input type="checkbox" checked={d.verified} onChange={e => act(Native.contactVerify(c.userId, d.publicKey, e.currentTarget.checked))} />
                                    {d.verified ? "код сверен" : "код не сверен"}
                                </label>}
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}
