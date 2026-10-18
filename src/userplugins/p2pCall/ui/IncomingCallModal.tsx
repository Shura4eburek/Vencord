/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, useEffect, UserStore } from "@webpack/common";

import type { CallController } from "../controller";
import { useCallView } from "./useCallView";

const nameOf = (id: string) => {
    const u = UserStore.getUser(id);
    return u?.globalName ?? u?.username ?? id;
};

/** Открытые окна входящих по порядку: Esc относится только к верхнему */
const openOrder: string[] = [];

/** Окно на каждый входящий: первый звонок или во время звонка (specs/004-group-calls US1) */
function IncomingCall({ c, linkId, modal }: { c: CallController; linkId: string; modal: RenderModalProps; }) {
    const v = useCallView(c);
    const inv = v.invites.find(i => i.linkId === linkId);
    useEffect(() => { if (!inv) modal.onClose(); }, [!inv]);
    // Esc в модалках Discord закрывает их мимо onClose — отклоняем по нему сами
    useEffect(() => {
        openOrder.push(linkId);
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && openOrder[openOrder.length - 1] === linkId) c.decline(linkId); };
        window.addEventListener("keydown", onKey, true);
        return () => {
            window.removeEventListener("keydown", onKey, true);
            openOrder.splice(openOrder.indexOf(linkId), 1);
        };
    }, []);
    if (!inv) return null;

    const user = UserStore.getUser(inv.from);
    const name = nameOf(inv.from);
    // крестик/клик мимо — иначе звонок остаётся входящим, а ответить уже негде
    const dismiss = () => { c.decline(linkId); modal.onClose(); };
    const group = inv.members.length ? `Групповой звонок: ${[name, ...inv.members.filter(m => m !== inv.from).map(nameOf)].join(", ")}` : null;
    const subtitle = group ?? (inv.video ? `${name} звонит с видео` : `${name} звонит`);
    const actions = v.inCall
        ? [
            { text: "Отклонить", variant: "secondary" as const, onClick: () => c.decline(linkId) },
            { text: "Положить текущий и принять", variant: "secondary" as const, onClick: () => c.replaceWith(linkId) },
            { text: "Добавить сюда", variant: "primary" as const, disabled: !!inv.addBlocked, onClick: () => { c.addHere(linkId); } },
        ]
        : [
            { text: "Отклонить", variant: "secondary" as const, onClick: () => c.decline(linkId) },
            { text: "Принять с видео", variant: "secondary" as const, onClick: () => c.accept(linkId, true) },
            { text: "Принять", variant: "primary" as const, onClick: () => c.accept(linkId, false) },
        ];
    return (
        <Modal
            {...modal}
            onClose={dismiss}
            title={v.inCall ? "Входящий P2P-звонок во время звонка" : "Входящий P2P-звонок"}
            subtitle={subtitle}
            actions={actions}
        >
            <div className="p2p-incoming">
                <img className="p2p-incoming-avatar" src={user?.getAvatarURL(undefined, 128)} alt="" />
                {v.inCall && inv.addBlocked && <div className="p2p-incoming-note">{inv.addBlocked}</div>}
            </div>
        </Modal>
    );
}

export function openIncomingCall(c: CallController, linkId: string) {
    openModal(modal => (
        <ErrorBoundary>
            <IncomingCall c={c} linkId={linkId} modal={modal} />
        </ErrorBoundary>
    ));
}
