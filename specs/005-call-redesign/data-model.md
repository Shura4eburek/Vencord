# Data Model: редизайн P2P-звонка

Все данные живут только в памяти renderer, ничего не сохраняется, кроме устройств в `settings.store`. Устройства там хранятся и сейчас.

## TabSeen

Когда в канале впервые замечен каждый звонок.

| поле | тип | правило |
|---|---|---|
| `discord` | `number \| null` | время, когда `renderCall()` впервые вернул не `null`; `null`, когда звонок пропал |
| `p2p` | `number \| null` | время, когда `areaVisible` впервые стал `true`; `null`, когда звонок пропал |

Хранится в `Map<channelId, TabSeen>`.

## TabPick

Ручной выбор вкладки: `"discord" | "p2p" | undefined`, хранится по `channelId`. Сбрасывается в `undefined`, когда один из звонков в канале пропал.

## pickTab(seen, pick) → "discord" | "p2p" | null

| условие | результат |
|---|---|
| нет обоих звонков | `null` — вкладок нет |
| `pick` задан | `pick` |
| иначе | вкладка звонка с бо́льшим `seen`; при равенстве — `"p2p"` |

## TabIndicator

| поле | тип | откуда |
|---|---|---|
| `count` | `number` | Discord: число voice states канала; P2P: участники + я |
| `speaking` | `boolean` | Discord: кто-то из voice states говорит; P2P: `view.speaking` любого участника |

## TileColor

Кэш `Map<avatarUrl, string | null>`:
- строка — цвет `#rrggbb`;
- `null` — посчитать не удалось, плитка берёт нейтральный фон.

Порядок источников описан в R5.

`averageColor(pixels: Uint8ClampedArray) → string | null` — чистая функция:
- пиксели с альфой < 128 пропускаются;
- если таких пикселей меньше 10%, результат `null`.

## DeviceKind

`"audioinput" | "audiooutput" | "videoinput"` → поля `settings.store.inputDevice` / `outputDevice` / `cameraDevice`.
