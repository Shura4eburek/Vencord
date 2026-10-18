---

description: "Task list for identity keys and contacts"
---

# Tasks: ключи и контакты P2PCall

**Input**: Design documents from `specs/003-identity-keys/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/pairing.md, quickstart.md

**Tests**: включены — quickstart требует `cpace.test.ts`, `pairing.test.ts`, `contacts.test.ts`, кейсы в `signaling.test.ts`.

Пути — относительно `src/userplugins/p2pCall/`, если не указано иное.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 `package.json` (корень): `@noble/curves` `2.0.1` прямой зависимостью (та же версия, что у `nostr-tools`), `pnpm install`, проверить, что в lock-файле одна копия

---

## Phase 2: Foundational

- [X] T002 [P] Тесты в `cpace.test.ts`: векторы `CPACE-RISTR255-SHA512` из приложения драфта (генератор, Ya/Yb, ISK); одинаковый пароль → один ISK, разный → разный; точка-ноль и неверная кодировка `Y` → ошибка
- [X] T003 [P] `cpace.ts`: `generator(prs, ci, sid)`, `start(prs, ci, sid) → { y, Y }`, `finish(y, Ypeer, sid, transcript) → ISK` по драфту — тесты T002 зелёные
- [X] T004 [P] Тесты в `contacts.test.ts` (хранилище в памяти): первый ключ контакта → `trusted`; второй ключ того же пользователя → `pending`; подтверждение, `verified`, удаление контакта/устройства; сохранение/загрузка через сериализацию
- [X] T005 [P] `contacts.ts`: `ContactBook` (инъекция load/save), `Identity` (генерация X25519 + `deviceId`, сериализация), `pairKey(identity, device)` и `hint(pairKey, day)` по research R3/R7, `verificationCode(pubA, pubB)` — тесты T004 зелёные

---

## Phase 3: User Story 1 — контакт появляется сам (P1) 🎯 MVP

**Goal**: двое с общим ЛС получают контакты друг друга без действий.

**Independent Test**: quickstart, живая проверка 1–3.

### Tests for User Story 1

- [X] T006 [P] [US1] Тесты в `pairing.test.ts`: два `Pairing` с общим `channelId` гоняют `pake1–4` в памяти → у обоих контакт, ключи пары и коды проверки совпадают; разный `channelId` → контакта нет и MAC отвергнут; `pake1` от пользователя без ЛС → игнор; `ts` старше 30 с → игнор
- [X] T007 [P] [US1] Тесты в `signaling.test.ts`: `ring` контакту с подсказкой ключа пары доходит и расшифровывается; подсказка прошлого дня тоже принимается; сообщения `pake*` идут без шифрования ключом пары и без тега `c`

### Implementation for User Story 1

- [X] T008 [US1] `pairing.ts`: `Pairing` (без Electron) — `start(peerId, channelId)`, `handle(msg, channelId|null)` → исходящие сообщения, сессии ≤ 30 с, MAC подтверждения, сохранение в `ContactBook` — тесты T006 зелёные
- [X] T009 [US1] `native.ts`: личность в `userData/p2pcall-identity.bin` под `safeStorage` (нет DPAPI → без шифрования + предупреждение), контакты в `userData/p2pcall-contacts.json`; IPC `pairingStart`, `pairingHandle`, `pairKeys`, `contactsList` по contracts §2
- [X] T010 [US1] `signaling.ts` + `crypto.ts`: ключи пар по `userId`/`deviceId`, `ring` контакту — по событию на каждое `trusted`-устройство с тегом `c = hint(day)`; входящий — сначала подсказки контактов (сегодня/вчера); типы `pake1–4` транспортом без шифрования — тесты T007 зелёные
- [X] T011 [US1] `controller.ts`: запуск обмена при открытии ЛС, при `dial`/`ring` и при старте для 20 последних ЛС без контакта (не чаще 10 мин на собеседника); входящие `pake*` → `pairingHandle` с `channelId` из сторов; после нового контакта — обновить ключи пар в `Signaling`

**Checkpoint**: живая проверка 1–3.

---

## Phase 4: User Story 2 — подмена ключа не проходит незаметно (P1)

**Goal**: смена ключа требует подтверждения; есть код проверки.

**Independent Test**: quickstart, живая проверка 4.

- [X] T012 [P] [US2] Тесты в `pairing.test.ts`: новый ключ известного контакта → устройство `pending`, ключ пары для него не выдаётся; лимиты — 6-й `pake1` за минуту от одного `from` и 31-й всего игнорируются; после неверного MAC — пауза 1 мин
- [X] T013 [US2] `pairing.ts`: лимиты и паузы по research R6 — тесты T012 зелёные
- [X] T014 [US2] `ui/Contacts.tsx` + `settings.tsx`: список контактов (имя, аватар, устройства, код проверки «1234 5678», переключатель «проверен», «подтвердить» для `pending`, удаление); IPC `contactConfirm`/`contactVerify`/`contactRemove`
- [X] T015 [US2] `index.tsx` + `controller.ts`: уведомление «У X новый ключ — новое устройство или подмена. Сверь код» с переходом к контакту; звонки от `pending`-устройства не принимаются

---

## Phase 5: User Story 3 — старые версии и переход (P2)

**Goal**: со старыми версиями звонки работают; после обмена старая схема с этим пользователем отключается.

**Independent Test**: quickstart, живая проверка 5.

- [X] T016 [P] [US3] Тесты в `signaling.test.ts`: без контакта прежняя схема (`pairHint` + ключ из ID канала) работает; с контактом сообщения прежней схемы от этого пользователя отбрасываются; исходящий `ring` контакту не содержит `pairHint`
- [X] T017 [US3] `signaling.ts`: правило перехода — тесты T016 зелёные

---

## Phase 6: Polish

- [X] T018 [P] `docs/p2pcall-connect.md` (раздел «Контакты и ключи», что делать при уведомлении о новом ключе) и `docs/p2pcall-todo.md` (закрыть «Ключ пары», шаг 1 дорожной карты)
- [X] T019 `npx tsx --test src/userplugins/p2pCall/*.test.ts`, `pnpm testTsc`, `npx eslint src/userplugins/p2pCall` — зелёные
- [ ] T020 Живая проверка по quickstart (1–5)

---

## Dependencies & Execution Order

- T001 → T002/T003. T002 ∥ T004; T003 после T002, T005 после T004.
- US1: T006 ∥ T007 (после T003+T005) → T008 (после T006) → T009 → T010 (после T007) → T011.
- US2: T012 → T013 (после T008); T014, T015 после T009.
- US3: T016 → T017 (после T010).
- Polish после всех.

### Parallel Opportunities

```text
T002 ∥ T004
T006 ∥ T007
T014 ∥ T016
```

## Implementation Strategy

1. **MVP**: Phase 1–3 — контакты и ключи пар, звонки шифруются стойко. Закрывает дыру перебора для пар на новой версии.
2. US2 — без неё ключи можно подменить незаметно; обязательна до релиза.
3. US3 — переход для старых версий; затем доки, ревью (криптография отдельным пунктом), релиз, живая проверка.

---

## Phase 7: Review fixes (после /code-review, 2026-10-18)

- [X] T021 Отключить прежнюю схему совсем (вариант B); звонок без ключа — обмен и ожидание до 8 с; `Pairing.start(force)` для звонка
- [X] T022 Пауза за ответчика без `pake3`; сессии не удаляются до проверки MAC; `pake1` не затирает сессию; проверка ключа X25519
- [X] T023 Атомарная запись контактов и ключа, копия битого файла, без смены ключа при сбое чтения; ключ пары по устройствам отдельно
- [X] T024 Без стартовой рассылки по ЛС (приватность); подсказка на завтра; ключи пар обновляются до `pake3`/`pairok`

