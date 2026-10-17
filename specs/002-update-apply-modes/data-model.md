# Data Model: обновления

## Part / Action

`Part = "start" | "window" | "net"`; `Action = "none" | "reload" | "restart"`.
`PART_OF: Record<file, Part>` — статичная таблица (research R2); `ACTION_OF: start→restart, window→reload, net→none`.
`strongest(actions) = max по порядку none < reload < restart`.

## ManifestV2 (подписан, `manifest-v2.json` + `manifest-v2.sig`)

| Поле | Тип | Правила |
|---|---|---|
| `version` | `YYYY.MM.DD-N` | как сейчас |
| `files` | `Record<имя, sha256>` | ровно `UPDATE_FILES_V2` = 4 прежних + `p2pcall-net.js` |
| `schema` | `2` | для будущих изменений формата |

Прежний `manifest.json` (4 файла) публикуется без изменений формата.

## UpdateResult (main → рендерер)

```
{ status: "dev" | "latest", version, pending: Action }
{ status: "updated", version, action: Action, changed: string[] }
{ status: "error", error, pending: Action }
```

`pending` — ещё не выполненное требование от прошлых обновлений в этой сессии main (FR-010).

## Pending (main, в памяти)

| Поле | Правила |
|---|---|
| `restart: boolean` | ставится при итоге restart или `netBroken`; живёт до перезапуска Discord |
| `reloadFor: WeakSet<WebContents>` | окна, которым нужна перезагрузка; снимается на `did-navigate` |

## NetModule (`dist/p2pcall-net.js`)

`createNet({ userData }) → { tunnelPrepare, tunnelSetPeer, tunnelStatus, tunnelClose, hasActive, dispose }`
— сигнатуры как у IPC в `specs/001-udp-tunnel-upnp/contracts/tunnel.md` §2, без первого аргумента.
Состояние загрузчика в `native.ts`: `{ mod, stamp: { mtimeMs, size }, broken: boolean }`.
