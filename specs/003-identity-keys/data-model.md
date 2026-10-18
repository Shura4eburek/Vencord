# Data Model: ключи и контакты

## Identity (main, `p2pcall-identity.bin`, safeStorage)

| Поле | Тип | Правила |
|---|---|---|
| `deviceId` | 16 байт hex | создаётся один раз |
| `privateKey` | X25519, 32 байта | не покидает main |
| `publicKey` | 32 байта | |

## Contact (main, `p2pcall-contacts.json`)

| Поле | Тип | Правила |
|---|---|---|
| `userId` | Discord ID | ключ записи |
| `name`, `avatar` | строка / URL | обновляются из Discord, когда он доступен |
| `channelId` | ID ЛС | через какой ЛС получен (нужен для повторных обменов) |
| `devices[]` | `{ deviceId, publicKey, addedAt, state: "trusted" \| "pending", verified: boolean, mutual: boolean }` | первый ключ контакта — `trusted`; следующие — `pending` до подтверждения |
| `addedAt` | ms | |

Переходы устройства: `pending → trusted` (подтверждение пользователем) · любое → удалено (удаление контакта/устройства).
`verified` ставит пользователь после сверки кода. `mutual` — у собеседника наш ключ тоже есть (research R5):
только тогда прежняя схема с ним отключается. Файл контактов — свой на каждый аккаунт Discord:
`p2pcall-contacts-<userId>.json`.

## PairKey (рендерер, в памяти)

`{ userId, deviceId, channelId, key: 32 байта, mutual }` — выдаётся main по IPC для `trusted`-устройств;
подсказка `hint(day)` считается в рендерере.

## PakeSession (main, в памяти)

`{ peerId, channelId, role: "init" | "resp", sid, y, Y, startedAt, step }` — живёт ≤ 30 с.

## RateLimit (main, в памяти)

Окна по `from` (5/мин) и общее (30/мин); `cooldownUntil` после неудачного MAC.
