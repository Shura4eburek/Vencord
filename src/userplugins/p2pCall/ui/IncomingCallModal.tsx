/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, useEffect, UserStore } from "@webpack/common";

import type { CallController } from "../controller";
import { CameraIcon, HangupIcon, PhoneIcon } from "./icons";
import { nameOf } from "./names";
import { useCallView } from "./useCallView";


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
    const sub = v.inCall ? "Звонит, пока вы в звонке" : inv.video ? "Видеозвонок" : "Входящий звонок";
    const avatar = user?.getAvatarURL(undefined, 128);
    return (
        <Modal {...modal} onClose={dismiss} size="sm" title="Входящий P2P-звонок">
            <div className="p2p-incoming">
                <span className="p2p-avatar p2p-pulse">{avatar && <img src={avatar} alt="" />}</span>
                <div className="p2p-incoming-name">{group ?? name}</div>
                <div className="p2p-incoming-sub">{sub}</div>
                {v.inCall ? (
                    <div className="p2p-incoming-list">
                        <button className="p2p-btn p2p-btn-danger" onClick={() => c.decline(linkId)}>Отклонить</button>
                        <button className="p2p-btn p2p-btn-secondary" onClick={() => c.replaceWith(linkId)}>Положить текущий и принять</button>
                        <button className="p2p-btn p2p-btn-positive" disabled={!!inv.addBlocked} onClick={() => c.addHere(linkId)}>Добавить сюда</button>
                        {inv.addBlocked && <div className="p2p-incoming-note">{inv.addBlocked}</div>}
                    </div>
                ) : (
                    <div className="p2p-incoming-actions">
                        <Act text="Отклонить" className="p2p-ctrl-danger" onClick={() => c.decline(linkId)}><HangupIcon /></Act>
                        <Act text="Принять" className="p2p-ctrl-positive" onClick={() => c.accept(linkId, false)}><PhoneIcon /></Act>
                        <Act text="С видео" className="p2p-ctrl-positive" onClick={() => c.accept(linkId, true)}><CameraIcon /></Act>
                    </div>
                )}
            </div>
        </Modal>
    );
}

function Act({ text, className, onClick, children }: { text: string; className: string; onClick(): void; children: React.ReactNode; }) {
    return (
        <div className="p2p-incoming-act">
            <button className={`p2p-ctrl ${className}`} aria-label={text} onClick={onClick}>{children}</button>
            {text}
        </div>
    );
}

export function openIncomingCall(c: CallController, linkId: string) {
    openModal(modal => (
        <ErrorBoundary>
            <IncomingCall c={c} linkId={linkId} modal={modal} />
        </ErrorBoundary>
    ));
}
