/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, useEffect, useState } from "@webpack/common";

import type { ScreenSource } from "../native";
import { savedQuality } from "../settings";
import { fpsAllowed, StreamQuality } from "../streamQuality";
import { QualityControls, useRefreshRate } from "./QualityControls";

const Native = VencordNative.pluginHelpers.P2PCall as PluginNative<typeof import("../native")>;

function Picker({ modal, onPick }: { modal: RenderModalProps; onPick(id: string, q: StreamQuality): void; }) {
    const hz = useRefreshRate();
    const [q, setQ] = useState<StreamQuality>(savedQuality);
    // FPS выше частоты монитора недоступен — понижаем до 60, если сохранённое значение не подходит
    const effective: StreamQuality = fpsAllowed(q.fps, hz) ? q : { ...q, fps: 60 };
    const [sources, setSources] = useState<ScreenSource[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        Native.getSources().then(setSources, e => setError(String(e?.message ?? e)));
    }, []);
    return (
        <Modal {...modal} title="Что показать?" actions={[{ text: "Отмена", variant: "secondary", onClick: modal.onClose }]}>
            <QualityControls value={effective} onChange={setQ} hz={hz} />
            <div className="p2p-sources">
                {error && <span>Не удалось получить список экранов: {error}</span>}
                {!error && sources === null && <span>Загрузка…</span>}
                {sources?.map(s => (
                    <button key={s.id} className="p2p-source" onClick={() => { onPick(s.id, effective); modal.onClose(); }}>
                        <img src={s.thumb} alt="" />
                        <span>{s.name}</span>
                    </button>
                ))}
            </div>
        </Modal>
    );
}

export const pickSource = (onPick: (id: string, q: StreamQuality) => void) =>
    openModal(modal => <Picker modal={modal} onPick={onPick} />);
