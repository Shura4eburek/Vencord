/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Цвет плитки участника (specs/005-call-redesign R5): акцент профиля, иначе средний цвет аватарки */

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, "0");

export const accentToHex = (n: number) => "#" + (n & 0xffffff).toString(16).padStart(6, "0");

/** Средний цвет непрозрачных пикселей RGBA; почти прозрачная картинка — null */
export function averageColor(px: Uint8ClampedArray): string | null {
    let r = 0, g = 0, b = 0, n = 0;
    const total = px.length / 4;
    for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 128) continue;
        r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
    }
    if (!total || n < total * 0.1) return null;
    return "#" + hex2(r / n) + hex2(g / n) + hex2(b / n);
}

const cache = new Map<string, Promise<string | null>>();
const SIZE = 16;

/** Средний цвет аватарки; CDN Discord отдаёт CORS, поэтому canvas не «грязный». Ошибка — null */
export function avatarColor(url: string): Promise<string | null> {
    let p = cache.get(url);
    if (!p) {
        p = new Promise(resolve => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                try {
                    const canvas = document.createElement("canvas");
                    canvas.width = canvas.height = SIZE;
                    const ctx = canvas.getContext("2d")!;
                    ctx.drawImage(img, 0, 0, SIZE, SIZE);
                    resolve(averageColor(ctx.getImageData(0, 0, SIZE, SIZE).data));
                } catch { resolve(null); }
            };
            img.onerror = () => resolve(null);
            img.src = url;
        });
        cache.set(url, p);
    }
    return p;
}
