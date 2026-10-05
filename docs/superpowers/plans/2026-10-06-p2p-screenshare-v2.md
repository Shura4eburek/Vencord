# P2PCall «Демка v2» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Демка с выбором разрешения, FPS (до 120/144) и потолка битрейта в окне выбора и на ходу, с аппаратным кодеком по возможностям обеих сторон и видимой причиной просадки.

**Architecture:** Чистые модули (`streamQuality`, `codecs`, `sdp.tuneVideo`, расширенный `stats`, `diagLog`) несут всю логику и покрыты тестами. `Session` обменивается возможностями кодеков по data channel `ctl`, выбирает кодек для своей демки и применяет параметры кодера; `CallController` хранит выбранное качество, меняет его на ходу (`applyConstraints` → запасной перезахват с `replaceTrack`) и пишет диагностику в лог. UI: панель качества в окне выбора и меню качества на ходу.

**Tech Stack:** TypeScript, WebRTC (`setCodecPreferences`, `setParameters`, `replaceTrack`, `getStats`), `navigator.mediaCapabilities`, Vencord plugin API, тесты `node:test` через `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-06-p2p-screenshare-v2-design.md`

## Global Constraints

- Плагин: `src/userplugins/p2pCall/`; файлы в git — через `git add -f`.
- Каждый `.ts/.tsx` начинается с лицензионного заголовка Vencord (иначе lint `simple-header`).
- **Никакого JSX на верхнем уровне модуля** (создание элементов при импорте роняет весь Vencord — глобального `Vencord` ещё нет). JSX — только внутри функций/компонентов.
- Тексты — на русском. Цвета — сплошные hex.
- Значения: разрешение `720 | 1080 | 1440 | 0` (0 = исходное), FPS `30 | 60 | 120 | 144`, потолок `10 | 20 | 40 | 80` Мбит/с, «при нехватке» `fps | detail`.
- По умолчанию: исходное / 60 / 20 / `fps`.
- Порядок кодеков: `video/AV1`, `video/H264`, `video/VP9`; запасной — `video/H264`.
- Проба возможностей: `type: "webrtc"`, 1920×1080, 60 FPS, 20 Мбит/с; в список — `supported && powerEfficient`.
- FPS серый, если `fps > hz * 1.05`.
- Диагностика: раз в 5 с в фазе `connected`, `console.info("[P2PCall] stats", json)`, выключается настройкой `diagLog`.
- Тесты плагина: `npx tsx --test "src/userplugins/p2pCall/*.test.ts"` из `<корень Vencord>`.
- Коммиты — Conventional Commits + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Отклонения от спеки (согласовать при ревью плана)

- **Стартовый битрейт — фиксированный.** `x-google-start-bitrate` пишется в SDP, который читает собеседник для **своей** отправки, а его потолок нам неизвестен. Поэтому во все видеокодеки ставится фиксированно `x-google-start-bitrate=10000` (верхняя граница из спеки), и дополнительно `x-google-max-bitrate=80000`, чтобы внутренний лимит Chromium не резал выбранный потолок. Реальный потолок по-прежнему задаёт `maxBitrate` отправителя.
- **Разведка без отдельного шага.** Запустить проверку внутри Discord я не могу. Вместо этого плагин при старте пишет в лог результат пробы кодеков (`[P2PCall] codecs {...}`), а `diagLog` — фактические FPS отправки. Первый живой звонок с 120 FPS и есть разведка; если FPS упрётся в 60 — отдельной правкой убрать 120/144 из меню.
- **Предел по ширине не считается по пропорциям.** Захват получает `maxHeight` = выбранная высота (0 → 4320) и `maxWidth = 7680`: Chromium вписывает источник с сохранением пропорций и не увеличивает выше исходного. Пропорции источника знать не нужно.
- **Перезахват сохраняет `MediaStream`.** При запасном пути новый трек кладётся в тот же локальный `MediaStream` (старый удаляется), иначе у собеседника сломается сопоставление «поток → демка» в сообщении `kinds`.
- **`hint` в `View` заменяется на `screenQuality`**, кнопка «Плавность/Чёткость» в области звонка — на меню качества.

## Review Focus

1. Демка запущена до прихода `caps` собеседника → кодек H.264, демка работает. Тест — Task 2.
2. В `getCapabilities` у H.264 несколько профилей → все уходят вперёд, ни один не теряется. Тест — Task 2.
3. Смена качества на ходу через перезахват → поток у собеседника не «теряется» (тот же `MediaStream`). Ручная проверка — Task 10; код — Task 7.
4. Повторная правка SDP (переговоры идут несколько раз) → параметры не дублируются. Тест — Task 3.
5. Камера и демка одновременно → в статистике «отправка» — демка (больший кадр). Тест — Task 4.

## File Structure

| Файл | Ответственность |
|---|---|
| `streamQuality.ts` (+test) | типы и пресеты качества, ограничения захвата, параметры кодера, частота монитора, `sanitizeQuality` |
| `codecs.ts` (+test) | `Caps`, `probeCaps`, `chooseCodec`, `orderCodecs` |
| `sdp.ts` (+test) | `tuneVideo` рядом с `tuneOpus` |
| `stats.ts` (+test) | `video.out` / `video.in` в `CallStats` |
| `diagLog.ts` (+test) | `compactStats` |
| `settings.tsx` | `screenCodec`, скрытые поля качества, `diagLog`; удалить `screenMaxBitrateMbps` |
| `media.ts` | `getScreen(sourceId, q)` |
| `session.ts` | обмен `caps`, кодек, параметры кодера по качеству, `replaceScreenTrack`, `tuneVideo` |
| `controller.ts` | `startScreen(id, q)`, `setScreenQuality(q)`, `View.screenQuality`, диагностика, проба при старте |
| `ui/SourcePicker.tsx` | панель качества, замер частоты |
| `ui/QualityControls.tsx` | общие селекторы качества (окно выбора + меню) |
| `ui/StreamQualityMenu.tsx` | меню качества на ходу |
| `ui/CallArea.tsx`, `ui/ConnectedPanel.tsx`, `styles.css` | подключение меню, чип с видео-статистикой |

---

### Task 1: `streamQuality.ts`

**Files:**
- Create: `src/userplugins/p2pCall/streamQuality.ts`
- Test: `src/userplugins/p2pCall/streamQuality.test.ts`

**Interfaces:**
- Produces:
```ts
export type Height = 720 | 1080 | 1440 | 0;
export type Fps = 30 | 60 | 120 | 144;
export type MaxMbps = 10 | 20 | 40 | 80;
export type Prefer = "fps" | "detail";
export interface StreamQuality { height: Height; fps: Fps; maxMbps: MaxMbps; prefer: Prefer; }
export const HEIGHTS: readonly Height[];      // [720, 1080, 1440, 0]
export const FPS_OPTIONS: readonly Fps[];     // [30, 60, 120, 144]
export const MBPS_OPTIONS: readonly MaxMbps[]; // [10, 20, 40, 80]
export const DEFAULT_QUALITY: StreamQuality;  // { height: 0, fps: 60, maxMbps: 20, prefer: "fps" }
export function heightLabel(h: Height): string; // "720p" … "Исходное"
export function captureConstraints(q: StreamQuality): { maxWidth: number; maxHeight: number; maxFrameRate: number; };
export function trackConstraints(q: StreamQuality): MediaTrackConstraints;
export function encoderParams(q: StreamQuality): { maxBitrate: number; maxFramerate: number; degradationPreference: "maintain-framerate" | "maintain-resolution"; contentHint: "motion" | "detail"; };
export function fpsAllowed(fps: Fps, hz: number): boolean;
export function hzFromIntervals(intervals: number[]): number;
export function sanitizeQuality(raw: Partial<Record<keyof StreamQuality, unknown>>): StreamQuality;
```

- [ ] **Step 1: Падающий тест**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { captureConstraints, DEFAULT_QUALITY, encoderParams, fpsAllowed, heightLabel, hzFromIntervals, sanitizeQuality, trackConstraints } from "./streamQuality";

test("defaults: source resolution, 60 fps, 20 Mbps, keep fps", () => {
    assert.deepEqual(DEFAULT_QUALITY, { height: 0, fps: 60, maxMbps: 20, prefer: "fps" });
});

test("capture constraints cap height and fps, never upscale width", () => {
    assert.deepEqual(captureConstraints({ height: 1080, fps: 120, maxMbps: 40, prefer: "fps" }), { maxWidth: 7680, maxHeight: 1080, maxFrameRate: 120 });
    assert.deepEqual(captureConstraints({ height: 0, fps: 60, maxMbps: 20, prefer: "fps" }), { maxWidth: 7680, maxHeight: 4320, maxFrameRate: 60 });
});

test("track constraints for live change", () => {
    assert.deepEqual(trackConstraints({ height: 720, fps: 30, maxMbps: 10, prefer: "fps" }), { height: { max: 720 }, frameRate: { max: 30 } });
    assert.deepEqual(trackConstraints({ height: 0, fps: 144, maxMbps: 80, prefer: "fps" }), { frameRate: { max: 144 } });
});

test("encoder params follow the quality", () => {
    assert.deepEqual(encoderParams({ height: 1440, fps: 120, maxMbps: 40, prefer: "fps" }),
        { maxBitrate: 40_000_000, maxFramerate: 120, degradationPreference: "maintain-framerate", contentHint: "motion" });
    assert.deepEqual(encoderParams({ height: 1440, fps: 30, maxMbps: 10, prefer: "detail" }),
        { maxBitrate: 10_000_000, maxFramerate: 30, degradationPreference: "maintain-resolution", contentHint: "detail" });
});

test("fps above the monitor refresh (+5%) is not allowed", () => {
    assert.equal(fpsAllowed(144, 179), true);
    assert.equal(fpsAllowed(144, 144), true);
    assert.equal(fpsAllowed(144, 60), false);
    assert.equal(fpsAllowed(60, 59.94), true);
    assert.equal(fpsAllowed(120, 75), false);
});

test("refresh rate from frame intervals uses the median", () => {
    assert.equal(hzFromIntervals([5.6, 5.58, 5.59, 33, 5.6]), 179);
    assert.equal(hzFromIntervals([16.67, 16.66, 16.68]), 60);
    assert.equal(hzFromIntervals([]), 60);
});

test("labels", () => {
    assert.equal(heightLabel(1440), "1440p");
    assert.equal(heightLabel(0), "Исходное");
});

test("sanitize falls back per field on garbage", () => {
    assert.deepEqual(sanitizeQuality({ height: 1440, fps: 120, maxMbps: 80, prefer: "detail" }), { height: 1440, fps: 120, maxMbps: 80, prefer: "detail" });
    assert.deepEqual(sanitizeQuality({ height: 999, fps: "x", maxMbps: undefined, prefer: 5 }), DEFAULT_QUALITY);
});
```

- [ ] **Step 2: Запустить — должен упасть**

Run: `npx tsx --test src/userplugins/p2pCall/streamQuality.test.ts`
Expected: FAIL — `Cannot find module './streamQuality'`.

- [ ] **Step 3: Реализация**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type Height = 720 | 1080 | 1440 | 0;
export type Fps = 30 | 60 | 120 | 144;
export type MaxMbps = 10 | 20 | 40 | 80;
export type Prefer = "fps" | "detail";
export interface StreamQuality { height: Height; fps: Fps; maxMbps: MaxMbps; prefer: Prefer; }

export const HEIGHTS: readonly Height[] = [720, 1080, 1440, 0];
export const FPS_OPTIONS: readonly Fps[] = [30, 60, 120, 144];
export const MBPS_OPTIONS: readonly MaxMbps[] = [10, 20, 40, 80];
export const DEFAULT_QUALITY: StreamQuality = { height: 0, fps: 60, maxMbps: 20, prefer: "fps" };

// без предела: Chromium вписывает источник и выше исходного не увеличивает
const MAX_W = 7680;
const MAX_H = 4320;

export const heightLabel = (h: Height) => (h === 0 ? "Исходное" : `${h}p`);

export function captureConstraints(q: StreamQuality) {
    return { maxWidth: MAX_W, maxHeight: q.height || MAX_H, maxFrameRate: q.fps };
}

export function trackConstraints(q: StreamQuality): MediaTrackConstraints {
    return q.height ? { height: { max: q.height }, frameRate: { max: q.fps } } : { frameRate: { max: q.fps } };
}

export function encoderParams(q: StreamQuality) {
    const keepFps = q.prefer === "fps";
    return {
        maxBitrate: q.maxMbps * 1_000_000,
        maxFramerate: q.fps,
        degradationPreference: keepFps ? "maintain-framerate" as const : "maintain-resolution" as const,
        contentHint: keepFps ? "motion" as const : "detail" as const,
    };
}

export const fpsAllowed = (fps: Fps, hz: number) => fps <= hz * 1.05;

/** Частота монитора по интервалам requestAnimationFrame (медиана — устойчива к редким пропускам кадров) */
export function hzFromIntervals(intervals: number[]): number {
    if (!intervals.length) return 60;
    const sorted = [...intervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return Math.round(1000 / median);
}

const pick = <T>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? v as T : fallback);

export function sanitizeQuality(raw: Partial<Record<keyof StreamQuality, unknown>>): StreamQuality {
    return {
        height: pick(raw.height, HEIGHTS, DEFAULT_QUALITY.height),
        fps: pick(raw.fps, FPS_OPTIONS, DEFAULT_QUALITY.fps),
        maxMbps: pick(raw.maxMbps, MBPS_OPTIONS, DEFAULT_QUALITY.maxMbps),
        prefer: pick(raw.prefer, ["fps", "detail"] as const, DEFAULT_QUALITY.prefer),
    };
}
```

- [ ] **Step 4: Запустить — должен пройти**

Run: `npx tsx --test src/userplugins/p2pCall/streamQuality.test.ts`
Expected: PASS, 8 тестов.

- [ ] **Step 5: Commit**

```bash
git add -f src/userplugins/p2pCall/streamQuality.ts src/userplugins/p2pCall/streamQuality.test.ts
git commit -m "feat(p2pcall): add stream quality presets and constraints" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `codecs.ts`

**Files:**
- Create: `src/userplugins/p2pCall/codecs.ts`
- Test: `src/userplugins/p2pCall/codecs.test.ts`

**Interfaces:**
- Produces:
```ts
export type VideoCodec = "video/AV1" | "video/H264" | "video/VP9";
export type CodecChoice = "auto" | VideoCodec;
export const CODEC_ORDER: readonly VideoCodec[]; // AV1, H264, VP9
export const FALLBACK_CODEC: VideoCodec;         // "video/H264"
export interface Caps { encodeHw: string[]; decodeHw: string[]; }
export const EMPTY_CAPS: Caps;
export function chooseCodec(manual: CodecChoice, own: Caps | null, peer: Caps | null): VideoCodec;
export function orderCodecs<T extends { mimeType: string; }>(codecs: T[], first: string): T[];
export function probeCaps(mc?: Pick<MediaCapabilities, "encodingInfo" | "decodingInfo">): Promise<Caps>;
export function isCaps(v: unknown): v is Caps;
```

- [ ] **Step 1: Падающий тест**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { chooseCodec, EMPTY_CAPS, isCaps, orderCodecs, probeCaps } from "./codecs";

const all = { encodeHw: ["video/AV1", "video/H264", "video/VP9"], decodeHw: ["video/AV1", "video/H264", "video/VP9"] };

test("auto picks AV1 when both sides do it in hardware", () => {
    assert.equal(chooseCodec("auto", all, all), "video/AV1");
});

test("auto skips AV1 when the peer can't decode it in hardware", () => {
    assert.equal(chooseCodec("auto", all, { encodeHw: [], decodeHw: ["video/H264", "video/VP9"] }), "video/H264");
});

test("auto skips a codec we can't encode in hardware", () => {
    assert.equal(chooseCodec("auto", { encodeHw: ["video/VP9"], decodeHw: [] }, all), "video/VP9");
});

test("no peer caps yet or no common codec → H264", () => {
    assert.equal(chooseCodec("auto", all, null), "video/H264");
    assert.equal(chooseCodec("auto", EMPTY_CAPS, EMPTY_CAPS), "video/H264");
});

test("manual choice wins", () => {
    assert.equal(chooseCodec("video/VP9", all, all), "video/VP9");
});

test("orderCodecs moves every entry of the chosen codec first, keeps the rest in order", () => {
    const caps = [
        { mimeType: "video/VP8", n: 1 },
        { mimeType: "video/H264", n: 2 },
        { mimeType: "video/rtx", n: 3 },
        { mimeType: "video/H264", n: 4 },
        { mimeType: "video/AV1", n: 5 },
    ];
    assert.deepEqual(orderCodecs(caps, "video/H264").map(c => c.n), [2, 4, 1, 3, 5]);
    assert.equal(orderCodecs(caps, "video/H264").length, caps.length);
});

test("probeCaps keeps only supported and power-efficient codecs", async () => {
    const mc = {
        encodingInfo: async (cfg: any) => ({ supported: true, smooth: true, powerEfficient: cfg.video.contentType !== "video/VP9" }),
        decodingInfo: async (cfg: any) => ({ supported: cfg.video.contentType !== "video/AV1", smooth: true, powerEfficient: true }),
    } as any;
    assert.deepEqual(await probeCaps(mc), { encodeHw: ["video/AV1", "video/H264"], decodeHw: ["video/H264", "video/VP9"] });
});

test("probeCaps survives a throwing or missing mediaCapabilities", async () => {
    const bad = { encodingInfo: async () => { throw new Error("no"); }, decodingInfo: async () => { throw new Error("no"); } } as any;
    assert.deepEqual(await probeCaps(bad), EMPTY_CAPS);
    assert.deepEqual(await probeCaps(undefined), EMPTY_CAPS);
});

test("isCaps validates the ctl message payload", () => {
    assert.equal(isCaps({ encodeHw: ["video/AV1"], decodeHw: [] }), true);
    assert.equal(isCaps({ encodeHw: "video/AV1", decodeHw: [] }), false);
    assert.equal(isCaps(null), false);
});
```

- [ ] **Step 2: Запустить — должен упасть**

Run: `npx tsx --test src/userplugins/p2pCall/codecs.test.ts`
Expected: FAIL — `Cannot find module './codecs'`.

- [ ] **Step 3: Реализация**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type VideoCodec = "video/AV1" | "video/H264" | "video/VP9";
export type CodecChoice = "auto" | VideoCodec;
export interface Caps { encodeHw: string[]; decodeHw: string[]; }

export const CODEC_ORDER: readonly VideoCodec[] = ["video/AV1", "video/H264", "video/VP9"];
export const FALLBACK_CODEC: VideoCodec = "video/H264";
export const EMPTY_CAPS: Caps = { encodeHw: [], decodeHw: [] };

/** Кодек для своей отправки: аппаратный у нас на кодирование и у собеседника на декодирование */
export function chooseCodec(manual: CodecChoice, own: Caps | null, peer: Caps | null): VideoCodec {
    if (manual !== "auto") return manual;
    if (!own || !peer) return FALLBACK_CODEC;
    return CODEC_ORDER.find(c => own.encodeHw.includes(c) && peer.decodeHw.includes(c)) ?? FALLBACK_CODEC;
}

/** Все записи выбранного кодека (у H.264 их несколько — профили) вперёд, остальные в прежнем порядке */
export function orderCodecs<T extends { mimeType: string; }>(codecs: T[], first: string): T[] {
    return [...codecs.filter(c => c.mimeType === first), ...codecs.filter(c => c.mimeType !== first)];
}

const PROBE = { width: 1920, height: 1080, bitrate: 20_000_000, framerate: 60 };

export async function probeCaps(mc: Pick<MediaCapabilities, "encodingInfo" | "decodingInfo"> | undefined = globalThis.navigator?.mediaCapabilities): Promise<Caps> {
    if (!mc) return { encodeHw: [], decodeHw: [] };
    const check = async (fn: () => Promise<MediaCapabilitiesInfo>) => {
        try {
            const r = await fn();
            return r.supported && r.powerEfficient;
        } catch {
            return false;
        }
    };
    const encodeHw: string[] = [];
    const decodeHw: string[] = [];
    for (const contentType of CODEC_ORDER) {
        const video = { contentType, ...PROBE };
        if (await check(() => mc.encodingInfo({ type: "webrtc", video } as MediaEncodingConfiguration))) encodeHw.push(contentType);
        if (await check(() => mc.decodingInfo({ type: "webrtc", video } as MediaDecodingConfiguration))) decodeHw.push(contentType);
    }
    return { encodeHw, decodeHw };
}

export function isCaps(v: unknown): v is Caps {
    if (!v || typeof v !== "object") return false;
    const c = v as Caps;
    return Array.isArray(c.encodeHw) && Array.isArray(c.decodeHw)
        && [...c.encodeHw, ...c.decodeHw].every(x => typeof x === "string");
}
```

- [ ] **Step 4: Запустить — должен пройти**

Run: `npx tsx --test src/userplugins/p2pCall/codecs.test.ts`
Expected: PASS, 9 тестов.

- [ ] **Step 5: Commit**

```bash
git add -f src/userplugins/p2pCall/codecs.ts src/userplugins/p2pCall/codecs.test.ts
git commit -m "feat(p2pcall): add hardware codec probing and selection" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `sdp.ts` — `tuneVideo`

**Files:**
- Modify: `src/userplugins/p2pCall/sdp.ts`
- Test: `src/userplugins/p2pCall/sdp.test.ts`

**Interfaces:**
- Produces: `VIDEO_START_KBPS = 10000`, `VIDEO_MAX_KBPS = 80000`, `tuneVideo(sdp: string): string` — во всех `a=fmtp` видеокодеков AV1/H264/VP9/VP8 ставит `x-google-start-bitrate` и `x-google-max-bitrate` (перезаписывает, не дублирует); если у видеокодека нет `a=fmtp` — добавляет после его `a=rtpmap`.

- [ ] **Step 1: Дописать падающие тесты в конец `sdp.test.ts`**

```ts
const VSDP = [
    "v=0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "a=rtpmap:111 opus/48000/2",
    "a=fmtp:111 minptime=10;useinbandfec=1",
    "m=video 9 UDP/TLS/RTP/SAVPF 96 97 45 102",
    "a=rtpmap:96 VP8/90000",
    "a=rtpmap:97 rtx/90000",
    "a=fmtp:97 apt=96",
    "a=rtpmap:45 AV1/90000",
    "a=fmtp:45 level-idx=5;profile=0;tier=0",
    "a=rtpmap:102 H264/90000",
    "a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f",
    "",
].join("\r\n");

test("tuneVideo sets start/max bitrate on video codecs only", () => {
    const out = tuneVideo(VSDP);
    assert.match(out, /a=fmtp:45 level-idx=5;profile=0;tier=0;x-google-start-bitrate=10000;x-google-max-bitrate=80000\r\n/);
    assert.match(out, /a=fmtp:102 [^\r]*x-google-start-bitrate=10000;x-google-max-bitrate=80000\r\n/);
    assert.match(out, /a=rtpmap:96 VP8\/90000\r\na=fmtp:96 x-google-start-bitrate=10000;x-google-max-bitrate=80000\r\n/);
    assert.match(out, /a=fmtp:97 apt=96\r\n/);
    assert.match(out, /a=fmtp:111 minptime=10;useinbandfec=1\r\n/);
});

test("tuneVideo is idempotent", () => {
    const once = tuneVideo(VSDP);
    assert.equal(tuneVideo(once), once);
});

test("tuneVideo leaves audio-only SDP unchanged", () => {
    const audio = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n";
    assert.equal(tuneVideo(audio), audio);
});
```

И в импорте `sdp.test.ts` добавить `tuneVideo`: `import { DEFAULT_OPUS, tuneOpus, tuneVideo } from "./sdp";`

- [ ] **Step 2: Запустить — должен упасть**

Run: `npx tsx --test src/userplugins/p2pCall/sdp.test.ts`
Expected: FAIL — `tuneVideo` не экспортируется.

- [ ] **Step 3: Реализация — в конец `sdp.ts`**

```ts
export const VIDEO_START_KBPS = 10_000;
export const VIDEO_MAX_KBPS = 80_000;
const VIDEO_CODECS = /^a=rtpmap:(\d+) (AV1|H264|VP9|VP8)\/90000/i;

/** Стартовый и предельный битрейт для видео: без них WebRTC разгоняется с ~300 кбит/с несколько секунд */
export function tuneVideo(sdp: string): string {
    const lines = sdp.split("\r\n");
    const want: [string, string][] = [["x-google-start-bitrate", String(VIDEO_START_KBPS)], ["x-google-max-bitrate", String(VIDEO_MAX_KBPS)]];
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(VIDEO_CODECS);
        if (!m) continue;
        const prefix = `a=fmtp:${m[1]} `;
        const fmtpIdx = lines.findIndex(l => l.startsWith(prefix));
        if (fmtpIdx >= 0) {
            const params = new Map<string, string>();
            for (const p of lines[fmtpIdx].slice(prefix.length).split(";")) {
                if (!p) continue;
                const [k, v = ""] = p.split("=");
                params.set(k.trim(), v.trim());
            }
            for (const [k, v] of want) params.set(k, v);
            lines[fmtpIdx] = prefix + [...params].map(([k, v]) => `${k}=${v}`).join(";");
        } else {
            lines.splice(i + 1, 0, prefix + want.map(([k, v]) => `${k}=${v}`).join(";"));
        }
    }
    return lines.join("\r\n");
}
```

- [ ] **Step 4: Запустить — должен пройти**

Run: `npx tsx --test src/userplugins/p2pCall/sdp.test.ts`
Expected: PASS, 9 тестов (6 + 3).

- [ ] **Step 5: Commit**

```bash
git add -f src/userplugins/p2pCall/sdp.ts src/userplugins/p2pCall/sdp.test.ts
git commit -m "feat(p2pcall): set start and max video bitrate in sdp" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `stats.ts` — видео-статистика

**Files:**
- Modify: `src/userplugins/p2pCall/stats.ts`
- Test: `src/userplugins/p2pCall/stats.test.ts`

**Interfaces:**
- Produces:
```ts
export type Limit = "none" | "cpu" | "bandwidth" | "other";
export interface VideoSide { width: number; height: number; fps: number; codec: string | null; hw: boolean | null; limit: Limit | null; }
// CallStats += video: { out: VideoSide | null; in: VideoSide | null; }
```
Отправка — `outbound-rtp` `kind: "video"` с наибольшим `frameWidth × frameHeight`; приём — то же для `inbound-rtp`. `hw` — `powerEfficientEncoder` / `powerEfficientDecoder` (если поля нет — `null`). `codec` — `mimeType` из записи `codecId`. `limit` — только для отправки (`qualityLimitationReason`, неизвестное значение → `other`).

- [ ] **Step 1: Дописать падающие тесты в конец `stats.test.ts`**

```ts
const video = [
    { type: "codec", id: "CAV1", mimeType: "video/AV1" },
    { type: "codec", id: "CH264", mimeType: "video/H264" },
    { type: "outbound-rtp", id: "OC", kind: "video", frameWidth: 1280, frameHeight: 720, framesPerSecond: 30, codecId: "CH264", powerEfficientEncoder: true, qualityLimitationReason: "none", bytesSent: 0 },
    { type: "outbound-rtp", id: "OS", kind: "video", frameWidth: 2560, frameHeight: 1440, framesPerSecond: 118, codecId: "CAV1", powerEfficientEncoder: true, qualityLimitationReason: "bandwidth", bytesSent: 0 },
    { type: "inbound-rtp", id: "IS", kind: "video", frameWidth: 1920, frameHeight: 1080, framesPerSecond: 60, codecId: "CH264", powerEfficientDecoder: false, packetsLost: 0, packetsReceived: 0, bytesReceived: 0 },
];

test("video out is the biggest outgoing stream (screen over camera)", () => {
    const s = summarizeStats([...base({}), ...video], 0);
    assert.deepEqual(s.video.out, { width: 2560, height: 1440, fps: 118, codec: "video/AV1", hw: true, limit: "bandwidth" });
});

test("video in reports decoder and has no limit", () => {
    const s = summarizeStats([...base({}), ...video], 0);
    assert.deepEqual(s.video.in, { width: 1920, height: 1080, fps: 60, codec: "video/H264", hw: false, limit: null });
});

test("no video → nulls; unknown limit → other; missing hw flag → null", () => {
    assert.deepEqual(summarizeStats(base({}), 0).video, { out: null, in: null });
    const s = summarizeStats([{ type: "outbound-rtp", id: "O", kind: "video", frameWidth: 10, frameHeight: 10, framesPerSecond: 1, qualityLimitationReason: "weird" }], 0);
    assert.deepEqual(s.video.out, { width: 10, height: 10, fps: 1, codec: null, hw: null, limit: "other" });
});
```

- [ ] **Step 2: Запустить — должен упасть**

Run: `npx tsx --test src/userplugins/p2pCall/stats.test.ts`
Expected: FAIL — `s.video` undefined.

- [ ] **Step 3: Реализация в `stats.ts`**

Добавить типы после `CallStats`:
```ts
export type Limit = "none" | "cpu" | "bandwidth" | "other";
export interface VideoSide { width: number; height: number; fps: number; codec: string | null; hw: boolean | null; limit: Limit | null; }
```
В `CallStats` добавить поле `video: { out: VideoSide | null; in: VideoSide | null; };`.

Перед `export function summarizeStats` добавить:
```ts
const LIMITS: Limit[] = ["none", "cpu", "bandwidth", "other"];

function biggest(reports: any[], type: string) {
    let best: any = null;
    for (const r of reports) {
        if (r.type !== type || r.kind !== "video") continue;
        const px = (r.frameWidth ?? 0) * (r.frameHeight ?? 0);
        if (!best || px > (best.frameWidth ?? 0) * (best.frameHeight ?? 0)) best = r;
    }
    return best;
}

function videoSide(r: any, byId: Map<string, any>, out: boolean): VideoSide | null {
    if (!r) return null;
    const hwFlag = out ? r.powerEfficientEncoder : r.powerEfficientDecoder;
    return {
        width: r.frameWidth ?? 0,
        height: r.frameHeight ?? 0,
        fps: Math.round(r.framesPerSecond ?? 0),
        codec: byId.get(r.codecId)?.mimeType ?? null,
        hw: typeof hwFlag === "boolean" ? hwFlag : null,
        limit: out ? (LIMITS.includes(r.qualityLimitationReason) ? r.qualityLimitationReason : "other") : null,
    };
}
```
В `summarizeStats`: в начале добавить `const all = [...reports];` и итерировать цикл по `all` вместо `reports`. Перед `return` добавить:
```ts
    const video = {
        out: videoSide(biggest(all, "outbound-rtp"), byId, true),
        in: videoSide(biggest(all, "inbound-rtp"), byId, false),
    };
```
и вернуть `{ rttMs, lossPct, inKbps, outKbps, path, counters, video }`.

Внимание: `reports` в сессии — итератор (`report.values()`), его можно пройти один раз, поэтому `const all = [...reports]` обязателен.

- [ ] **Step 4: Запустить — должен пройти**

Run: `npx tsx --test src/userplugins/p2pCall/stats.test.ts`
Expected: PASS, 8 тестов (5 + 3).

- [ ] **Step 5: Commit**

```bash
git add -f src/userplugins/p2pCall/stats.ts src/userplugins/p2pCall/stats.test.ts
git commit -m "feat(p2pcall): report video resolution, fps, codec and quality limit" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `diagLog.ts`

**Files:**
- Create: `src/userplugins/p2pCall/diagLog.ts`
- Test: `src/userplugins/p2pCall/diagLog.test.ts`

**Interfaces:**
- Consumes: Task 4 (`CallStats`, `VideoSide`).
- Produces: `compactStats(s: CallStats): Record<string, unknown>`, `videoLabel(v: VideoSide): string`, `LIMIT_TEXT: Record<Limit, string>`.

- [ ] **Step 1: Падающий тест**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { compactStats, videoLabel } from "./diagLog";
import type { CallStats } from "./stats";

const s: CallStats = {
    rttMs: 3, lossPct: 0.5, inKbps: 900, outKbps: 38000, path: "srflx",
    counters: { at: 0, recvBytes: 0, sentBytes: 0, lost: 0, received: 0 },
    video: {
        out: { width: 2560, height: 1440, fps: 118, codec: "video/AV1", hw: true, limit: "bandwidth" },
        in: null,
    },
};

test("compactStats keeps what matters and drops raw counters", () => {
    assert.deepEqual(compactStats(s), {
        rtt: 3, loss: 0.5, inKbps: 900, outKbps: 38000, path: "srflx",
        vOut: "2560x1440@118 AV1 hw limit=bandwidth", vIn: null,
    });
});

test("videoLabel for the chip", () => {
    assert.equal(videoLabel(s.video.out!), "1440p · 118 FPS · AV1 (аппаратный) · ограничение: канал");
    assert.equal(videoLabel({ width: 1280, height: 720, fps: 30, codec: "video/VP9", hw: false, limit: "none" }), "720p · 30 FPS · VP9 (программный)");
    assert.equal(videoLabel({ width: 1280, height: 720, fps: 30, codec: null, hw: null, limit: null }), "720p · 30 FPS");
});
```

- [ ] **Step 2: Запустить — должен упасть**

Run: `npx tsx --test src/userplugins/p2pCall/diagLog.test.ts`
Expected: FAIL — `Cannot find module './diagLog'`.

- [ ] **Step 3: Реализация**

```ts
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { CallStats, Limit, VideoSide } from "./stats";

export const LIMIT_TEXT: Record<Limit, string> = { none: "нет", cpu: "процессор", bandwidth: "канал", other: "другое" };

const short = (codec: string | null) => codec?.replace(/^video\//, "") ?? null;

function videoLine(v: VideoSide | null): string | null {
    if (!v) return null;
    const parts = [`${v.width}x${v.height}@${v.fps}`];
    if (v.codec) parts.push(short(v.codec)!);
    if (v.hw !== null) parts.push(v.hw ? "hw" : "sw");
    if (v.limit) parts.push(`limit=${v.limit}`);
    return parts.join(" ");
}

/** Сводка для строки «[P2PCall] stats» в логе Discord */
export function compactStats(s: CallStats) {
    return {
        rtt: s.rttMs, loss: s.lossPct, inKbps: s.inKbps, outKbps: s.outKbps, path: s.path,
        vOut: videoLine(s.video.out), vIn: videoLine(s.video.in),
    };
}

/** Подпись для чипа: «1440p · 118 FPS · AV1 (аппаратный) · ограничение: канал» */
export function videoLabel(v: VideoSide): string {
    const parts = [`${v.height}p`, `${v.fps} FPS`];
    if (v.codec) parts.push(v.hw === null ? short(v.codec)! : `${short(v.codec)} (${v.hw ? "аппаратный" : "программный"})`);
    if (v.limit && v.limit !== "none") parts.push(`ограничение: ${LIMIT_TEXT[v.limit]}`);
    return parts.join(" · ");
}
```

- [ ] **Step 4: Запустить — должен пройти**

Run: `npx tsx --test src/userplugins/p2pCall/diagLog.test.ts`
Expected: PASS, 2 теста.

- [ ] **Step 5: Commit**

```bash
git add -f src/userplugins/p2pCall/diagLog.ts src/userplugins/p2pCall/diagLog.test.ts
git commit -m "feat(p2pcall): add compact stats for diagnostics log and chip" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: настройки и захват

**Files:**
- Modify: `src/userplugins/p2pCall/settings.tsx`
- Modify: `src/userplugins/p2pCall/media.ts`

**Interfaces:**
- Consumes: Task 1 (`StreamQuality`, `captureConstraints`, `DEFAULT_QUALITY`, `sanitizeQuality`), Task 2 (`CodecChoice`).
- Produces: `settings.store.screenCodec: CodecChoice`, `settings.store.screenHeight/screenFps/screenMaxMbps/screenPrefer`, `settings.store.diagLog: boolean`, `savedQuality(): StreamQuality`, `saveQuality(q: StreamQuality): void`, `getScreen(sourceId: string, q: StreamQuality): Promise<MediaStream>`.

- [ ] **Step 1: `settings.tsx`**

Удалить строку `screenMaxBitrateMbps: …`.

Добавить импорты:
```ts
import { DEFAULT_QUALITY, sanitizeQuality, StreamQuality } from "./streamQuality";
```
Добавить в `definePluginSettings({...})` перед `showStats`:
```ts
    screenCodec: {
        type: OptionType.SELECT, description: "Кодек демки",
        options: [
            { label: "Авто (лучший аппаратный у обоих)", value: "auto", default: true },
            { label: "AV1", value: "video/AV1" },
            { label: "H.264", value: "video/H264" },
            { label: "VP9", value: "video/VP9" },
        ],
    },
    diagLog: { type: OptionType.BOOLEAN, description: "Писать статистику звонка в лог Discord (раз в 5 с)", default: true },
    screenHeight: { type: OptionType.NUMBER, description: "", default: DEFAULT_QUALITY.height, hidden: true },
    screenFps: { type: OptionType.NUMBER, description: "", default: DEFAULT_QUALITY.fps, hidden: true },
    screenMaxMbps: { type: OptionType.NUMBER, description: "", default: DEFAULT_QUALITY.maxMbps, hidden: true },
    screenPrefer: { type: OptionType.STRING, description: "", default: DEFAULT_QUALITY.prefer, hidden: true },
```
В конец файла:
```ts
export const savedQuality = (): StreamQuality => sanitizeQuality({
    height: settings.store.screenHeight,
    fps: settings.store.screenFps,
    maxMbps: settings.store.screenMaxMbps,
    prefer: settings.store.screenPrefer,
});

export function saveQuality(q: StreamQuality) {
    settings.store.screenHeight = q.height;
    settings.store.screenFps = q.fps;
    settings.store.screenMaxMbps = q.maxMbps;
    settings.store.screenPrefer = q.prefer;
}
```

- [ ] **Step 2: `media.ts` — `getScreen` с качеством**

Добавить импорт `import { captureConstraints, StreamQuality } from "./streamQuality";` и заменить `getScreen`:
```ts
export function getScreen(sourceId: string, q: StreamQuality) {
    return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
            mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: sourceId,
                ...captureConstraints(q),
            },
        } as MediaTrackConstraints,
    });
}
```

- [ ] **Step 3: Проверка**

Run: `npx tsx --test "src/userplugins/p2pCall/*.test.ts" && npx eslint src/userplugins/p2pCall && npx tsc --noEmit 2>&1 | grep "p2pCall" ; echo done`
Expected: тесты и lint зелёные; `tsc` ругается только на `controller.ts` (`screenMaxBitrateMbps`, `getScreen` с одним аргументом) — исправляется в Task 8.

- [ ] **Step 4: Commit**

```bash
git add -f src/userplugins/p2pCall/settings.tsx src/userplugins/p2pCall/media.ts
git commit -m "feat(p2pcall): add codec, diagnostics and saved quality settings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `session.ts` — кодек, качество, `replaceScreenTrack`

**Files:**
- Modify: `src/userplugins/p2pCall/session.ts`

**Interfaces:**
- Consumes: Task 1 (`StreamQuality`, `encoderParams`, `DEFAULT_QUALITY`), Task 2 (`Caps`, `CodecChoice`, `chooseCodec`, `orderCodecs`, `isCaps`), Task 3 (`tuneVideo`).
- Produces:
  - `new Session(polite: boolean, cb: SessionCallbacks, opts: { ownCaps: Promise<Caps>; codec: () => CodecChoice; })`
  - `setScreenQuality(q: StreamQuality): Promise<void>` (вместо `setScreenHint`)
  - `replaceScreenTrack(track: MediaStreamTrack): Promise<void>`
  - `screenCodec(): string | null` — выбранный для демки кодек
  - тип `ScreenHint` удаляется.

- [ ] **Step 1: Импорты и поля**

Импорты:
```ts
import { Caps, chooseCodec, CodecChoice, isCaps, orderCodecs } from "./codecs";
import { DEFAULT_OPUS, tuneOpus, tuneVideo } from "./sdp";
import { CallStats, Counters, summarizeStats } from "./stats";
import { DEFAULT_QUALITY, encoderParams, StreamQuality } from "./streamQuality";
```
Удалить `export type ScreenHint = …;` и `const VIDEO_ORDER = …;`.

Добавить после `ICE_SERVERS`:
```ts
export interface SessionOptions { ownCaps: Promise<Caps>; codec: () => CodecChoice; }
const tuneSdp = (sdp: string) => tuneVideo(tuneOpus(sdp, DEFAULT_OPUS));
```
Поля: заменить `private hint: ScreenHint = "motion";` на
```ts
    private quality: StreamQuality = DEFAULT_QUALITY;
    private own: Caps | null = null;
    private peer: Caps | null = null;
    private chosen: string | null = null;
```

- [ ] **Step 2: Конструктор**

Сигнатуру заменить на `constructor(private polite: boolean, private cb: SessionCallbacks, opts: SessionOptions)`, сохранить `this.codecChoice = opts.codec;` (поле `private codecChoice: () => CodecChoice;`).

`this.ctl.onopen = () => this.sendKinds();` заменить на:
```ts
        this.ctl.onopen = () => { this.sendKinds(); this.sendCaps(); };
        opts.ownCaps.then(c => { this.own = c; this.sendCaps(); });
```
Обе отправки SDP (`onnegotiationneeded` и ответ в `apply`) — заменить `tuneOpus(…, DEFAULT_OPUS)` на `tuneSdp(…)`.

- [ ] **Step 3: Выбор кодека и параметры в `setTrack`**

Блок `if (kind === "screen") { … }` заменить на:
```ts
            if (kind === "screen") {
                const tr = this.pc.getTransceivers().find(t => t.sender === sender);
                this.chosen = chooseCodec(this.codecChoice(), this.own, this.peer);
                const caps = RTCRtpReceiver.getCapabilities("video")?.codecs ?? [];
                tr?.setCodecPreferences(orderCodecs(caps, this.chosen));
                await this.applyScreenParams();
            }
```
Метод `setScreenHint` заменить на:
```ts
    async setScreenQuality(q: StreamQuality) {
        this.quality = q;
        await this.applyScreenParams();
    }

    /** Новый трек захвата в тот же MediaStream: id потока у собеседника не меняется, пересогласование не нужно */
    async replaceScreenTrack(track: MediaStreamTrack) {
        const sender = this.senders.get("screen");
        const stream = this.local.get("screen");
        if (!sender || !stream) { track.stop(); return; }
        const old = stream.getVideoTracks()[0];
        await sender.replaceTrack(track);
        if (old) { stream.removeTrack(old); old.stop(); }
        stream.addTrack(track);
        await this.applyScreenParams();
    }

    screenCodec() { return this.senders.has("screen") ? this.chosen : null; }
```
`applyScreenParams` заменить на:
```ts
    private async applyScreenParams() {
        const sender = this.senders.get("screen");
        if (!sender?.track) return;
        const e = encoderParams(this.quality);
        sender.track.contentHint = e.contentHint;
        const p = sender.getParameters();
        if (!p.encodings?.length) p.encodings = [{}];
        p.encodings[0].maxBitrate = e.maxBitrate;
        p.encodings[0].maxFramerate = e.maxFramerate;
        (p as any).degradationPreference = e.degradationPreference;
        await sender.setParameters(p).catch(err => console.warn("[P2PCall] setParameters", err));
    }
```

- [ ] **Step 4: Обмен `caps` по `ctl`**

Добавить метод:
```ts
    private sendCaps() {
        if (this.ctl.readyState !== "open" || !this.own) return;
        this.ctl.send(JSON.stringify({ type: "caps", ...this.own }));
    }
```
`onCtl` заменить на:
```ts
    private onCtl(data: string) {
        let m: { type?: string; kinds?: Record<string, TrackKind>; encodeHw?: unknown; decodeHw?: unknown; };
        try { m = JSON.parse(data); } catch { return; }
        if (m.type === "caps") {
            const caps = { encodeHw: m.encodeHw, decodeHw: m.decodeHw };
            if (isCaps(caps)) this.peer = caps;
            return;
        }
        if (m.type !== "kinds" || !m.kinds) return;
        const before = new Map(this.remoteKinds);
        this.remoteKinds = new Map(Object.entries(m.kinds));
        for (const [id, kind] of before) if (!this.remoteKinds.has(id)) this.cb.remoteMedia(kind, null);
        for (const id of this.remoteKinds.keys()) this.emitRemote(id);
    }
```

- [ ] **Step 5: Проверка**

Run: `npx eslint --fix src/userplugins/p2pCall/session.ts && npx tsc --noEmit 2>&1 | grep "p2pCall" ; echo done`
Expected: ошибки только в `controller.ts` (новая сигнатура `Session`, `setScreenHint`, `ScreenHint`) — Task 8.

- [ ] **Step 6: Commit**

```bash
git add -f src/userplugins/p2pCall/session.ts
git commit -m "feat(p2pcall): negotiate screen codec by hardware caps and apply quality" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `controller.ts` — качество, смена на ходу, диагностика

**Files:**
- Modify: `src/userplugins/p2pCall/controller.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 5, 6, 7.
- Produces: `View.screenQuality: StreamQuality` (вместо `hint`), `startScreen(sourceId: string, q: StreamQuality)`, `setScreenQuality(q: StreamQuality): Promise<void>`, удалены `setHint` и `ScreenHint`.

- [ ] **Step 1: Импорты, `View`, поля**

Импорты: убрать `ScreenHint` из импорта `./session`; добавить
```ts
import { CodecChoice, probeCaps } from "./codecs";
import { compactStats } from "./diagLog";
import { saveQuality, savedQuality } from "./settings";   // в существующий импорт из ./settings
import { StreamQuality, trackConstraints } from "./streamQuality";
```
В `View`: `hint: ScreenHint;` → `screenQuality: StreamQuality;`. В начальном `v`: `hint: "motion"` → `screenQuality: savedQuality()`.

Поля класса:
```ts
    private ownCaps = probeCaps().then(c => { console.info("[P2PCall] codecs", JSON.stringify(c)); return c; });
    private screenSource: string | null = null;
    private diagTimer: ReturnType<typeof setInterval> | undefined;
```

- [ ] **Step 2: Демка**

`startScreen` заменить на:
```ts
    async startScreen(sourceId: string, q: StreamQuality) {
        const { session } = this;
        if (!session) return;
        saveQuality(q);
        this.set({ screenQuality: q });
        try {
            const screen = await getScreen(sourceId, q);
            if (this.session !== session) { screen.getTracks().forEach(t => t.stop()); return; }
            screen.getVideoTracks()[0].onended = () => { this.stopScreen(); };
            this.screenSource = sourceId;
            await session.setScreenQuality(q);
            await session.setTrack("screen", screen);
            this.set({ local: { ...this.v.local, screen } });
        } catch (e) {
            this.hooks.warn("Не удалось захватить экран: " + (e as Error).message);
        }
    }
```
`setHint` заменить на:
```ts
    /** Смена качества на ходу: applyConstraints, при неудаче — перезахват того же источника */
    async setScreenQuality(q: StreamQuality) {
        const { session } = this;
        const stream = this.v.local.screen;
        saveQuality(q);
        this.set({ screenQuality: q });
        if (!session || !stream) return;
        const track = stream.getVideoTracks()[0];
        const want = q.height || Infinity;
        let ok = false;
        try {
            await track.applyConstraints(trackConstraints(q));
            const s = track.getSettings();
            ok = (s.height ?? 0) <= want && (s.frameRate ?? 0) <= q.fps + 1;
        } catch { }
        if (!ok && this.screenSource) {
            try {
                const fresh = await getScreen(this.screenSource, q);
                if (this.session !== session) { fresh.getTracks().forEach(t => t.stop()); return; }
                const t = fresh.getVideoTracks()[0];
                t.onended = () => { this.stopScreen(); };
                await session.replaceScreenTrack(t);
                ok = true;
            } catch { }
        }
        if (!ok) this.hooks.warn("Не удалось сменить качество демки");
        await session.setScreenQuality(q);
    }
```
В `stopScreen` после `setTrack("screen", null)` добавить `this.screenSource = null;`.

- [ ] **Step 3: Сессия и диагностика**

В `startSession` создание `Session` заменить третий аргумент `settings.store.screenMaxBitrateMbps * 1_000_000` на:
```ts
        { ownCaps: this.ownCaps, codec: () => settings.store.screenCodec as CodecChoice },
```
После `this.statsTimer = setInterval(...)` добавить:
```ts
        this.diagTimer = setInterval(() => {
            if (this.session !== session || this.v.call.phase !== "connected" || !settings.store.diagLog || !this.v.stats) return;
            console.info("[P2PCall] stats", JSON.stringify({ ...compactStats(this.v.stats), screenCodec: session.screenCodec(), quality: this.v.screenQuality }));
        }, 5000);
```
В `stopSession` рядом с `clearInterval(this.statsTimer);` добавить `clearInterval(this.diagTimer);` и `this.screenSource = null;`.

- [ ] **Step 4: Проверка**

Run: `npx eslint --fix src/userplugins/p2pCall/controller.ts && npx tsc --noEmit 2>&1 | grep "p2pCall" ; echo done`
Expected: ошибки только в `ui/CallArea.tsx` / `ui/SourcePicker.tsx` (`setHint`, `hint`, `startScreen(id)`) — Task 9.

- [ ] **Step 5: Commit**

```bash
git add -f src/userplugins/p2pCall/controller.ts
git commit -m "feat(p2pcall): live screen quality changes and diagnostics logging" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: UI — окно выбора, меню на ходу, чип

**Files:**
- Create: `src/userplugins/p2pCall/ui/QualityControls.tsx`
- Create: `src/userplugins/p2pCall/ui/StreamQualityMenu.tsx`
- Modify: `src/userplugins/p2pCall/ui/SourcePicker.tsx`
- Modify: `src/userplugins/p2pCall/ui/CallArea.tsx`
- Modify: `src/userplugins/p2pCall/ui/ConnectedPanel.tsx`
- Modify: `src/userplugins/p2pCall/styles.css`

**Interfaces:**
- Consumes: Task 1, Task 5 (`videoLabel`), Task 6 (`savedQuality`), Task 8 (`startScreen(id, q)`, `setScreenQuality`, `View.screenQuality`).
- Produces: `QualityControls({ value, onChange, hz })`, `pickSource(onPick: (id: string, q: StreamQuality) => void)`, `StreamQualityMenu({ c })`, `useRefreshRate(): number`.

- [ ] **Step 1: `ui/QualityControls.tsx`**

```tsx
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classes } from "@utils/misc";
import { useEffect, useState } from "@webpack/common";

import { FPS_OPTIONS, fpsAllowed, HEIGHTS, heightLabel, hzFromIntervals, MBPS_OPTIONS, StreamQuality } from "../streamQuality";

/** Частота монитора: 500 мс requestAnimationFrame, медиана интервалов */
export function useRefreshRate(): number {
    const [hz, setHz] = useState(60);
    useEffect(() => {
        let raf = 0, last = 0, alive = true;
        const intervals: number[] = [];
        const start = performance.now();
        const tick = (t: number) => {
            if (!alive) return;
            if (last) intervals.push(t - last);
            last = t;
            if (t - start < 500) raf = requestAnimationFrame(tick);
            else setHz(hzFromIntervals(intervals));
        };
        raf = requestAnimationFrame(tick);
        return () => { alive = false; cancelAnimationFrame(raf); };
    }, []);
    return hz;
}

function Row<T extends string | number>({ label, options, value, text, disabled, onPick }: {
    label: string; options: readonly T[]; value: T; text(v: T): string; disabled?(v: T): boolean; onPick(v: T): void;
}) {
    return (
        <div className="p2p-q-row">
            <span className="p2p-q-label">{label}</span>
            <div className="p2p-q-options">
                {options.map(o => {
                    const off = disabled?.(o) ?? false;
                    return (
                        <button key={String(o)} disabled={off}
                            className={classes("p2p-q-opt", o === value && "p2p-q-on")}
                            onClick={() => onPick(o)}>
                            {text(o)}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export function QualityControls({ value, onChange, hz }: { value: StreamQuality; onChange(q: StreamQuality): void; hz: number; }) {
    return (
        <div className="p2p-q">
            <Row label="Разрешение" options={HEIGHTS} value={value.height} text={heightLabel} onPick={height => onChange({ ...value, height })} />
            <Row label="FPS" options={FPS_OPTIONS} value={value.fps} text={String} disabled={f => !fpsAllowed(f, hz)} onPick={fps => onChange({ ...value, fps })} />
            <Row label="Потолок" options={MBPS_OPTIONS} value={value.maxMbps} text={m => `${m} Мбит/с`} onPick={maxMbps => onChange({ ...value, maxMbps })} />
            <Row label="При нехватке" options={["fps", "detail"] as const} value={value.prefer}
                text={p => (p === "fps" ? "держать FPS" : "держать чёткость")} onPick={prefer => onChange({ ...value, prefer })} />
        </div>
    );
}
```

- [ ] **Step 2: `ui/SourcePicker.tsx` — панель качества**

Добавить импорты:
```ts
import { savedQuality } from "../settings";
import { fpsAllowed, StreamQuality } from "../streamQuality";
import { QualityControls, useRefreshRate } from "./QualityControls";
```
`Picker` — сигнатура `onPick(id: string, q: StreamQuality): void`; в начале:
```ts
    const hz = useRefreshRate();
    const [q, setQ] = useState<StreamQuality>(savedQuality);
    // FPS выше частоты монитора недоступен — понижаем до 60, если сохранённое значение не подходит
    const effective: StreamQuality = fpsAllowed(q.fps, hz) ? q : { ...q, fps: 60 };
```
Перед `<div className="p2p-sources">` вставить `<QualityControls value={effective} onChange={setQ} hz={hz} />`, а в кнопке источника `onPick(s.id)` заменить на `onPick(s.id, effective)`.

`pickSource` — сигнатура `(onPick: (id: string, q: StreamQuality) => void)`.

- [ ] **Step 3: `ui/StreamQualityMenu.tsx`**

```tsx
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useRef, useState } from "@webpack/common";

import type { CallController } from "../controller";
import { QualityControls, useRefreshRate } from "./QualityControls";
import { useCallView } from "./useCallView";

/** Стрелочка у кнопки демки: качество идущей демки на ходу */
export function StreamQualityMenu({ c, up }: { c: CallController; up?: boolean; }) {
    const v = useCallView(c);
    const hz = useRefreshRate();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
        window.addEventListener("mousedown", close);
        return () => window.removeEventListener("mousedown", close);
    }, [open]);
    if (!v.local.screen) return null;
    return (
        <div className="p2p-qmenu" ref={ref}>
            <button className="p2p-qmenu-btn" aria-label="Качество демки" onClick={() => setOpen(!open)}>▾</button>
            {open && (
                <div className={up ? "p2p-qmenu-pop p2p-qmenu-up" : "p2p-qmenu-pop"}>
                    <QualityControls value={v.screenQuality} hz={hz} onChange={q => c.setScreenQuality(q)} />
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 4: `ui/CallArea.tsx`**

- Импорты: `import { videoLabel } from "../diagLog";`, `import { StreamQualityMenu } from "./StreamQualityMenu";`.
- Кнопку `p2p-hint` («Плавность/Чёткость») удалить целиком и на её место поставить `<StreamQualityMenu c={c} up />`.
- В `onClick` кнопки экрана `pickSource(id => c.startScreen(id))` заменить на `pickSource((id, q) => c.startScreen(id, q))`.
- Чип заменить на:
```tsx
            {connected && settings.store.showStats && v.stats && (
                <div className="p2p-chip">
                    <div>{v.stats.rttMs ?? "—"} мс · потери {v.stats.lossPct}% · {PATH_TEXT[v.stats.path]}</div>
                    {v.stats.video.out && <div>↑ {videoLabel(v.stats.video.out)} · {Math.round(v.stats.outKbps / 1000)} Мбит/с</div>}
                    {v.stats.video.in && <div>↓ {videoLabel(v.stats.video.in)}</div>}
                </div>
            )}
```

- [ ] **Step 5: `ui/ConnectedPanel.tsx`**

- Импорт `import { StreamQualityMenu } from "./StreamQualityMenu";`.
- `pickSource(id => c.startScreen(id))` → `pickSource((id, q) => c.startScreen(id, q))`.
- Сразу после `Tooltip` кнопки экрана вставить `<StreamQualityMenu c={c} up />`.

- [ ] **Step 6: `styles.css` — дописать в конец**

```css
.p2p-q {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 0 8px;
}

.p2p-q-row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.p2p-q-label {
    width: 110px;
    flex-shrink: 0;
    font-size: 13px;
    color: #b5bac1;
}

.p2p-q-options {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}

.p2p-q-opt {
    padding: 4px 10px;
    border: 0;
    border-radius: 4px;
    background: #2b2d31;
    color: #dbdee1;
    font-size: 13px;
    cursor: pointer;
}

.p2p-q-opt:hover:not(:disabled) {
    background: #3f4147;
}

.p2p-q-on {
    background: #5865f2;
    color: #fff;
}

.p2p-q-on:hover:not(:disabled) {
    background: #4752c4;
}

.p2p-q-opt:disabled {
    opacity: 0.35;
    cursor: not-allowed;
}

.p2p-qmenu {
    position: relative;
}

.p2p-qmenu-btn {
    width: 24px;
    height: 48px;
    border: 0;
    border-radius: 12px;
    background: #2b2d31;
    color: #f2f3f5;
    cursor: pointer;
}

.p2p-plaque .p2p-qmenu-btn {
    height: 32px;
    border-radius: 4px;
    background: none;
    color: #b5bac1;
}

.p2p-qmenu-pop {
    position: absolute;
    z-index: 100;
    left: 50%;
    top: calc(100% + 8px);
    transform: translateX(-50%);
    width: 420px;
    padding: 12px;
    border-radius: 8px;
    background: #111214;
    box-shadow: 0 8px 24px rgb(0 0 0 / 50%);
}

.p2p-qmenu-up {
    top: auto;
    bottom: calc(100% + 8px);
}

.p2p-plaque .p2p-qmenu-pop {
    left: auto;
    right: 0;
    transform: none;
}
```
И в `.p2p-chip` добавить `display: flex; flex-direction: column; gap: 2px; text-align: right;`.

- [ ] **Step 6.5: Убедиться, что нет JSX на верхнем уровне модулей**

Run: `npx tsx --test src/userplugins/p2pCall/icons.test.ts` и
`npx tsx -e "import('./src/userplugins/p2pCall/streamQuality'); import('./src/userplugins/p2pCall/diagLog'); import('./src/userplugins/p2pCall/codecs')"`
Expected: без ошибок.

- [ ] **Step 7: Полная проверка**

Run: `npx eslint --fix src/userplugins/p2pCall && npx tsx --test "src/userplugins/p2pCall/*.test.ts" && pnpm testTsc && pnpm build`
Expected: всё зелёное, тестов 73 + 8 + 9 + 3 + 3 + 2 = 98.

- [ ] **Step 8: Commit**

```bash
git add -f src/userplugins/p2pCall/ui/QualityControls.tsx src/userplugins/p2pCall/ui/StreamQualityMenu.tsx src/userplugins/p2pCall/ui/SourcePicker.tsx src/userplugins/p2pCall/ui/CallArea.tsx src/userplugins/p2pCall/ui/ConnectedPanel.tsx src/userplugins/p2pCall/styles.css
git commit -m "feat(p2pcall): stream quality picker, live quality menu and video stats chip" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Ручная проверка и пакет

- [ ] **Step 1:** Пересобрать установочный архив (папка `P2PCall-Vencord`: новая `dist`, те же `install.cmd`/`uninstall.cmd`/`README.txt`), положить в `%USERPROFILE%\Downloads\P2PCall-Vencord.zip`.
- [ ] **Step 2 (с собеседником):**
  - в окне выбора экрана есть панель качества; FPS выше частоты монитора серые;
  - демка 1440p / 120 FPS / 40 Мбит/с: чип показывает кодек и «(аппаратный)»;
  - смена качества на ходу через ▾ — без разрыва, у собеседника демка не пропадает;
  - сцена с эффектами: битрейт у потолка; если нет — в чипе причина;
  - в `%APPDATA%\discord\logs\renderer_js.log` строки `[P2PCall] codecs` и `[P2PCall] stats`.
- [ ] **Step 3:** Если `[P2PCall] stats` показывает FPS отправки ≤ 60 при выбранных 120 — отдельная правка: убрать 120/144 из `FPS_OPTIONS`.
