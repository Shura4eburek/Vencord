# Contracts: обмен ключами и контакты

## 1. Сообщения обмена (Nostr kind 25050, тема — линия получателя, без тега `c`)

| type | Поля | Шифрование |
|---|---|---|
| `pake1` | `sid` (16 B hex), `Y` (32 B hex), `from`, `dev`, `ts` | нет (случайная точка) |
| `pake2` | `sid`, `Y`, `from`, `dev`, `ts`, `box` = XChaCha20-Poly1305(HKDF(ISK,"box"), { pub, mac }) | `box` — ключом из ISK |
| `pake3` | `sid`, `from`, `ts`, `box` | `box` — ключом из ISK |

Тег `k=pake` в событии, без тега `c`. После `pake3` ответчик шлёт `pairok` (обычный сигнал на ключе пары,
тег `c = hint(day)`) — инициатор помечает ключ взаимным.

Отбрасываются: `ts` старше 30 с, неизвестный `sid`, точка-ноль или неверная кодировка `Y`, MAC не сошёлся.

## 2. IPC (рендерер → main)

| Функция | Вход | Выход |
|---|---|---|
| `pairingHandle(msg, ctx)` | входящее сообщение обмена + `{ channelId }` из сторов (или `null`) | исходящие сообщения для отправки |
| `pairingStart(peerId, channelId)` | | `pake1` для отправки или `null` (лимит/уже есть контакт) |
| `contactsList()` | | `Contact[]` без приватных данных + код проверки |
| `contactConfirm(userId, deviceId)` / `contactVerify(userId, verified)` / `contactRemove(userId, deviceId?)` | | `void` |
| `pairKeys()` | | `PairKey[]` для `trusted`-устройств (ключ hex, `mutual`) |
| `pairingInit(selfId)` | | загружает личность и контакты аккаунта |
| `contactMutual(userId, deviceId)` / `contactProfile(userId, name, avatar)` | | `void` |

Рендерер только транспортирует сообщения обмена (Signaling) и берёт из Discord-сторов `channelId` для `from`.

## 3. Сигналинг звонков

- `ring` контакту: тег `c` = `hint(day)` ключа пары (research R7), содержимое — ключом пары; одно событие
  на каждое `trusted`-устройство собеседника; пока ни один ключ не взаимный — плюс копия по прежней схеме.
- Входящий `ring`: сначала подсказки контактов (сегодня/вчера), затем — прежняя схема, только если с этим
  пользователем нет контакта.
