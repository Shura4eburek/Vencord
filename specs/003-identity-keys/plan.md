# Implementation Plan: ключи и контакты P2PCall

**Branch**: `feat/p2p-call` | **Date**: 2026-10-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/003-identity-keys/spec.md`

## Summary

У каждой установки своя пара X25519, хранящаяся в main под `safeStorage`. Собеседники с общим ЛС сами
обмениваются ключами через релеи Nostr по CPace (PAKE), где паролем служит ID их ЛС-канала: сообщения
обмена — случайные точки группы, офлайн-перебор невозможен, онлайн-попытки ограничены. Результат —
локальная книга контактов и ключ пары на каждое устройство собеседника; им шифруется сигналинг, а
подсказка в `ring` больше не выводится из ID канала. Код проверки ловит подмену самим Discord; смена ключа
не принимается без подтверждения; со старыми версиями — прежняя схема до первого обмена.
Решения — [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript, сборка Vencord; Electron main + renderer Discord

**Primary Dependencies**: `@noble/curves@2.0.1` (ristretto255, x25519 — уже в дереве через `nostr-tools`, станет прямой), `@noble/hashes`, `@noble/ciphers` (уже есть), Electron `safeStorage`

**Storage**: `userData/p2pcall-identity.bin` (safeStorage), `userData/p2pcall-contacts.json`

**Testing**: `node:test` + `tsx --test`; векторы CPace из драфта; двусторонние тесты обмена в памяти

**Target Platform**: Discord для Windows с Vencord

**Project Type**: плагин клиентского мода

**Performance Goals**: обмен ключами ≤ 10 с при обоих онлайн; звонки без изменения времени соединения

**Constraints**: никаких сообщений в Discord, своих серверов и действий пользователя; приватный ключ только в main; старые версии продолжают звонить

**Scale/Scope**: десятки контактов, по 1–3 устройства

## Constitution Check

Шаблон без принципов — гейтов нет. Особое внимание: собственная реализация криптопротокола — только по
драфту, с векторами и отдельным пунктом в финальном ревью. Нарушений нет.

## Project Structure

```text
specs/003-identity-keys/   plan.md research.md data-model.md quickstart.md contracts/pairing.md tasks.md

src/userplugins/p2pCall/
├── cpace.ts / cpace.test.ts       # НОВЫЕ: CPace ristretto255/SHA-512 (чистые функции)
├── pairing.ts / pairing.test.ts   # НОВЫЕ: протокол pake1–4, сессии, лимиты, код проверки (без Electron)
├── contacts.ts / contacts.test.ts # НОВЫЕ: книга контактов и личность (хранилище через инъекцию)
├── native.ts                      # IPC: pairing*, contacts*, pairKeys; safeStorage и файлы userData
├── crypto.ts                      # pairKey/hint(day) по ключу пары
├── signaling.ts / .test.ts        # ключи пар + подсказки контактов; отказ от прежней схемы для контактов; pake-сообщения
├── controller.ts                  # запуск обмена (ЛС, звонок, старт), передача сообщений, обновление ключей пар
├── settings.tsx + ui/Contacts.tsx # НОВЫЙ список контактов: код проверки, «проверен», подтверждение, удаление
└── index.tsx                      # уведомление о новом ключе контакта
package.json                        # @noble/curves 2.0.1 прямой зависимостью
docs/p2pcall-connect.md, docs/p2pcall-todo.md
```

**Structure Decision**: криптография и протокол — чистые модули без Electron (тестируются под Node);
`native.ts` хранит секреты и выполняет протокол; рендерер — транспорт и интерфейс.

**Про обновления (002)**: `cpace/pairing/contacts` попадают в `patcher.js` — первый релиз с фичей попросит
перезапуск Discord; это ожидаемо.

## Phases (для `/speckit-tasks`)

1. **CPace** — `cpace.ts` + векторы.
2. **Протокол и контакты** — `pairing.ts`, `contacts.ts` + двусторонние тесты (US1, US2).
3. **Main** — личность под `safeStorage`, файлы, IPC.
4. **Сигналинг** — ключи пар, подсказки, переход со старой схемы (US1, US3).
5. **Интеграция и UI** — запуск обмена, список контактов, код проверки, уведомление о новом ключе (US1, US2).
6. Доки, финальное ревью (с упором на криптографию), живая проверка.

## Risks

| Риск | Что делаем |
|---|---|
| Ошибка в собственной реализации CPace | строго по драфту, векторы из него, свойства в тестах, отдельный пункт ревью |
| `safeStorage` недоступен (нет DPAPI) | ключ в файле без шифрования + предупреждение в логе; функциональность не теряется |
| Оба собеседника редко онлайн одновременно | обмен повторяется при каждом открытии ЛС/звонке; звонок без контакта идёт по старой схеме |
| Discord-сторы не дают `channelId` для `from` (нет ЛС) | обмен невозможен — это и есть защита; контакт появится, когда ЛС будет |

## Complexity Tracking

Нарушений нет.
