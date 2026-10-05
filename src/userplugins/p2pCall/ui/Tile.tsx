/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classes } from "@utils/misc";
import { useEffect, useRef, UserStore } from "@webpack/common";

import { HeadphonesOffIcon, MicOffIcon } from "./icons";

interface TileProps {
    userId: string;
    video: MediaStream | null;
    mirror?: boolean;
    speaking: boolean;
    micOff?: boolean;
    deafened?: boolean;
    ringing?: boolean;
}

function Video({ stream, mirror }: { stream: MediaStream; mirror?: boolean; }) {
    const ref = useRef<HTMLVideoElement>(null);
    useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
    return (
        <video
            ref={ref}
            className={classes("p2p-video", mirror && "p2p-mirror")}
            autoPlay
            playsInline
            muted
            onDoubleClick={e => e.currentTarget.requestFullscreen?.()}
        />
    );
}

export function Tile({ userId, video, mirror, speaking, micOff, deafened, ringing }: TileProps) {
    const user = UserStore.getUser(userId);
    const name = user?.globalName ?? user?.username ?? userId;
    const avatar = user?.getAvatarURL(undefined, 128);
    return (
        <div className={classes("p2p-tile", speaking && "p2p-speaking", ringing && "p2p-ringing")}>
            {video
                ? <Video stream={video} mirror={mirror} />
                : <img className="p2p-avatar" src={avatar} alt="" />}
            <div className="p2p-tile-label">
                <span>{name}</span>
                {micOff && <MicOffIcon width={16} height={16} className="p2p-tile-badge" />}
                {deafened && <HeadphonesOffIcon width={16} height={16} className="p2p-tile-badge" />}
            </div>
        </div>
    );
}
