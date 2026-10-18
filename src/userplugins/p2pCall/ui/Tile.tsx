/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classes } from "@utils/misc";
import { useEffect, useRef, UserProfileStore, UserStore, useState } from "@webpack/common";

import { accentToHex, avatarColor } from "../tileColor";
import { HeadphonesOffIcon, MicOffIcon } from "./icons";
import { nameOf } from "./names";

interface TileProps {
    userId: string;
    video: MediaStream | null;
    mirror?: boolean;
    /** Демонстрация экрана: плашка «В эфире», картинка целиком */
    live?: boolean;
    speaking: boolean;
    micOff?: boolean;
    deafened?: boolean;
    ringing?: boolean;
    /** Участник в звонке, но связи с ним нет (specs/004-group-calls R7) */
    noLink?: boolean;
    /** Плитка в полосе режима фокуса */
    small?: boolean;
    onClick?(): void;
}

/** Цвет плитки: акцент профиля, иначе средний цвет аватарки (specs/005-call-redesign R5) */
function useTileColor(userId: string, avatar: string | undefined) {
    const accent = UserProfileStore.getUserProfile(userId)?.accentColor;
    const [color, setColor] = useState<string | null>(null);
    useEffect(() => {
        if (accent != null || !avatar) return;
        let alive = true;
        avatarColor(avatar).then(c => { if (alive) setColor(c); });
        return () => { alive = false; };
    }, [accent, avatar]);
    return accent != null ? accentToHex(accent) : color;
}

/** Есть ли у потока живой видеотрек — до первого кадра плитка показывает аватарку */
function hasVideo(stream: MediaStream | null) {
    return !!stream?.getVideoTracks().some(t => t.readyState === "live");
}

function Video({ stream, mirror, contain, dblFullscreen }: { stream: MediaStream; mirror?: boolean; contain?: boolean; dblFullscreen: boolean; }) {
    const ref = useRef<HTMLVideoElement>(null);
    useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
    return (
        <video
            ref={ref}
            className={classes("p2p-video", mirror && "p2p-mirror", contain && "p2p-video-contain")}
            autoPlay
            playsInline
            muted
            // у плитки с кликом (фокус в группе) два клика двойного переключили бы фокус туда и обратно
            onDoubleClick={dblFullscreen ? e => e.currentTarget.requestFullscreen?.() : undefined}
        />
    );
}

export function Tile({ userId, video, mirror, live, speaking, micOff, deafened, ringing, noLink, small, onClick }: TileProps) {
    const user = UserStore.getUser(userId);
    const name = nameOf(userId);
    const avatar = user?.getAvatarURL(undefined, small ? 64 : 128);
    const color = useTileColor(userId, avatar);
    const withVideo = hasVideo(video);
    return (
        <div
            className={classes("p2p-tile", speaking && "p2p-speaking", ringing && "p2p-ringing", noLink && "p2p-nolink", withVideo && "p2p-has-video", onClick && "p2p-tile-clickable")}
            style={color ? { "--p2p-banner": color } as React.CSSProperties : undefined}
            tabIndex={onClick ? 0 : undefined}
            role={onClick ? "button" : undefined}
            onClick={onClick}
            onKeyDown={onClick && (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } })}
        >
            {withVideo && <Video stream={video!} mirror={mirror} contain={live} dblFullscreen={!onClick} />}
            <div className="p2p-tile-center">
                <span className="p2p-avatar">{avatar && <img src={avatar} alt="" />}</span>
                {ringing && <span className="p2p-caption">Вызов…</span>}
                {noLink && !ringing && <span className="p2p-caption"><span className="p2p-spinner" />соединение…</span>}
            </div>
            {live && withVideo && <span className="p2p-live">В эфире</span>}
            {(deafened || micOff) && (
                <span className="p2p-badge">
                    {deafened ? <HeadphonesOffIcon width={16} height={16} /> : <MicOffIcon width={16} height={16} />}
                </span>
            )}
            <span className="p2p-name">{name}</span>
        </div>
    );
}
