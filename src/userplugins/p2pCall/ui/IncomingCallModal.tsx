/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, useEffect, UserStore } from "@webpack/common";

import type { CallController } from "../controller";
import { useCallView } from "./useCallView";

function IncomingCall({ c, modal }: { c: CallController; modal: RenderModalProps; }) {
    const v = useCallView(c);
    const { call } = v;
    const incoming = call.phase === "incoming";
    useEffect(() => { if (!incoming) modal.onClose(); }, [incoming]);
    if (!incoming) return null;

    const user = UserStore.getUser(call.peerId);
    const name = user?.globalName ?? user?.username ?? call.peerId;
    return (
        <Modal
            {...modal}
            title="Входящий P2P-звонок"
            subtitle={call.video ? `${name} звонит с видео` : `${name} звонит`}
            actions={[
                { text: "Отклонить", variant: "secondary", onClick: () => c.decline() },
                { text: "Принять с видео", variant: "secondary", onClick: () => c.accept(true) },
                { text: "Принять", variant: "primary", onClick: () => c.accept(false) },
            ]}
        >
            <div className="p2p-incoming">
                <img className="p2p-incoming-avatar" src={user?.getAvatarURL(undefined, 128)} alt="" />
            </div>
        </Modal>
    );
}

export function openIncomingCall(c: CallController) {
    openModal(modal => <IncomingCall c={c} modal={modal} />);
}
