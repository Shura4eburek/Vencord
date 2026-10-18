# Data Model: групповые звонки

Все сущности — в памяти рендерера, кроме контакта по представлению (книга контактов в main, `003`).

## Group (renderer, `group.ts`)

| Поле | Тип | Правила |
|---|---|---|
| `id` | string | `callId` первой связи звонка (R2) |
| `entries` | `RosterEntry[]` | вступления: `{ userId, joinedAt, by }` |
| `tombs` | `{ userId, leftAt }[]` | уходы |
| `startedAt` | number | для отображения |

- Участник **в составе**, если его последний `joinedAt` > последнего `leftAt` (R6). Себя — тоже в составе.
- `members(g)` — не больше 5; добавление шестого отклоняется (FR-005).
- `mergeRoster(a, b)` — идемпотентна, коммутативна, ассоциативна (тесты).
- Группа завершена, когда в составе остался только сам пользователь.

## Member (вычисляемое для UI)

`{ userId, name, avatar, by, link: LinkState | null, speaking, video }` — из `Group` + `PeerLink` +
профиля Discord (или книги контактов, если пользователь Discord недоступен).

## PeerLink (renderer, `controller.ts` / новый `link.ts`)

| Поле | Тип | Правила |
|---|---|---|
| `linkId` | string | `callId` в сигналинге и в `net.ts` |
| `userId` | string | участник |
| `channelId` | string | ЛС с ним, если есть, иначе `""` |
| `session` | `Session` | своя на связь |
| `tunnel` | `CallTunnel` | как сейчас, но по `linkId` |
| `audio`, `meter` | | свои на связь |
| `state` | `"linking" \| "connecting" \| "connected" \| "lost"` | `lost` — ICE failed, участник ещё в составе |
| `lastHere` | number | время последнего `here` (R7) |
| `caps` | `string[]` | из `ring`/`accept` |

Переходы: `linking` (отправлен/получен `link`) → `connecting` (`accept`) → `connected` (ICE) ⇄ `lost`
(ICE failed → повтор ICE restart; `here` идёт — участник остаётся). Нет `here` 15 с → связь закрыта,
участник — надгробие.

## Invite (renderer)

Входящий вызов во время звонка: `{ linkId, from, channelId, video, group?: { id, members } }` + свой
экземпляр автомата `reduce` (фаза `incoming`) и таймер 30 с. Действия — R8.

## Contact device по представлению (main, `contacts.ts`)

Как `Device` из `003` плюс `via?: string` — Discord ID того, кто передал ключ. `channelId` контакта —
`""`, пока нет общего ЛС (появится при CPace-обмене, тогда `via` снимается). Правило смены ключа — `003`.
