---

description: "Task list for P2PCall group calls"
---

# Tasks: групповые звонки P2PCall

**Input**: Design documents from `specs/004-group-calls/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/group-signaling.md, quickstart.md

**Tests**: включены — quickstart требует `group.test.ts`, кейсы в `state.test.ts`, `contacts.test.ts`, `signaling.test.ts`, тесты туннелей.

Пути — относительно `src/userplugins/p2pCall/`, если не указано иное.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

Новых зависимостей и структуры нет — фаза пустая.

---

## Phase 2: Foundational (блокирует US2–US5)

- [X] T001 [P] Тесты в `group.test.ts`: `mergeRoster` идемпотентна и коммутативна; одновременные добавления двух людей сходятся; участник «в составе», если «его последний `joinedAt` > последнего `leftAt`»; повторное вступление после ухода; `members(g)` «не больше 5» — добавление шестого отклоняется; `initiator(a, b)` — меньший Discord ID (BigInt); «остался только сам» → `ended`
- [X] T002 [P] `group.ts`: типы `Group { id, entries: { userId, joinedAt, by }[], tombs: { userId, leftAt }[], startedAt }`, `RosterWire`, `MemberKey` (contracts), чистые `newGroup`, `join`, `leave`, `mergeRoster`, `members`, `isMember`, `initiator`, `isAlone`, `MAX_MEMBERS = 5` — тесты T001 зелёные
- [X] T003 [P] `net.ts`: `Map<callId, ActiveTunnel>` вместо одного `active` (prepare/setPeer/status/close по `callId`, `closeAll` — все), `activeCallId()` → признак «есть хоть один туннель» для `netLoader.ts`; файл `p2pcall-upnp.json` — список пробросов (старый формат-объект читать как список из одного); тест в `netLoader.test.ts`: модуль не перезагружается, пока открыт хоть один туннель (сам `createNet` без сети не тестируется — UPnP и STUN настоящие)
- [X] T004 `link.ts`: класс `PeerLink` — вынести из `controller.ts` всё, что относится к одной связи: `Session`, `CallTunnel` (prepare/sendTun/onTun/linkTunnel/close), `pendingSignals`, `iceRestarted`/`onIce`, `<audio>` и `LevelMeter` собеседника, `stats()`; поля `linkId`, `userId`, `channelId`, `state: "linking" | "connecting" | "connected" | "lost"`, `lastHere`, `caps`; локальные треки передаются снаружи (`setTrack` во все связи). Поведение звонка вдвоём не меняется
- [X] T005 `controller.ts`: перейти на `Map<userId, PeerLink>` и `Group` (звонок вдвоём = группа из двух, `groupId` = `callId` первой связи); `View` — `members: Member[]` (`{ userId, name, avatar, by, link, speaking, video }`) вместо `remote`/`speaking.peer`; микрофон/камера/демка захватываются один раз и добавляются во все связи; «оглушение» глушит все `<audio>`. Тесты существующих модулей зелёные, `pnpm testTsc` чистый
- [X] T006 `ui/CallArea.tsx`, `ui/Tile.tsx`, `ui/ConnectedPanel.tsx`: перейти на `View.members` (вдвоём выглядит как сейчас); чип статистики — по связи с выбранным/единственным участником

**Checkpoint**: звонок вдвоём работает как до фичи (ручной звонок Mamoru ↔ doomer).

---

## Phase 3: User Story 1 — входящий во время звонка виден (P1) 🎯 MVP

**Goal**: вместо молчаливого `busy` — окно «Отклонить / Положить текущий и принять / Добавить сюда».

**Independent Test**: двое в звонке, третий звонит → окно; «Отклонить» → у звонящего «отклонено»; «Положить текущий и принять» → старый звонок завершён, новый идёт (quickstart 1–3).

- [X] T007 [P] [US1] Тесты в `state.test.ts`: `ring` во время звонка без `auto` больше не даёт `decline busy` (автомат текущего звонка не меняется, приглашение создаёт контроллер); `ring` с `auto` чужой группы и `ring` при 5 участниках — `decline busy`; переподключение того же собеседника (`ring` с новым callId) — как сейчас
- [X] T008 [US1] Решение при реализации: у каждой связи свой автомат `reduce` (он не менялся), маршрут входящего `ring` — чистая `routeRing` в `group.ts` (`primary`/`invite`/`auto-accept`/`busy`), тесты в `group.test.ts`
- [X] T009 [US1] `controller.ts`: очередь приглашений `Invite { linkId, from, channelId, video, group? }`, у каждого свой экземпляр автомата `reduce` (фаза `incoming`), свой таймер 30 с, рингтон общий — звучит, пока есть хоть один входящий (`syncRingtone`); `declineInvite(linkId)`, `replaceWith(linkId)` (`leave`/`bye` текущих связей → принять), `View.invites`
- [X] T010 [US1] `ui/IncomingCallModal.tsx`: окно на каждое приглашение; во время звонка — «Отклонить», «Положить текущий и принять», «Добавить сюда» (пока US2 нет — кнопка скрыта); крестик/Esc/клик мимо → `declineInvite`; проверить, что Esc действительно вызывает `onClose` (баг из `docs/p2pcall-todo.md`), иначе — `keydown` Escape
- [X] T011 [US1] `index.tsx`: `onIncoming` открывает окно и для приглашений; несколько входящих — независимые окна

**Checkpoint**: US1 проверяется вдвоём + третий, без групп.

---

## Phase 4: User Story 2 — «Добавить сюда» (P1)

**Goal**: входящий или исходящий во время звонка добавляет человека; все слышат всех.

**Independent Test**: quickstart 4, 5.

- [X] T012 [P] [US2] Тесты в `contacts.test.ts`: `introduce(via, key)` — новый контакт → `trusted` с `via`, `channelId: ""`; другой ключ известного контакта → `pending`; известный ключ → `known`; свой ключ пропускается; устройство из CPace не перезаписывается, а при последующем CPace у устройства снимается `via` и ставится `channelId`
- [X] T013 [P] [US2] `contacts.ts`: `Device.via?: string`, `ContactBook.introduce(...)` — тесты T012 зелёные
- [X] T014 [US2] `native.ts`: IPC `contactIntroduce(via, keys: MemberKey[]) → { userId, result }[]`; `contactsList` отдаёт `via`; `ownMemberKey()` → свой `{ deviceId, publicKey }` для рассылки
- [X] T015 [P] [US2] Тесты в `signaling.test.ts`: поля `caps`, `group`, `keys`, `auto` и тип `intro` проходят шифрование ключом связи; сообщение от участника по ключу из представления расшифровывается после `setPairKeys`
- [X] T016 [US2] `signaling.ts`: `SignalType` += `"intro" | "roster" | "here" | "leave"`, поля `caps?`, `group?`, `keys?`, `key?`, `auto?`, `groupId?` (contracts/group-signaling.md) — тесты T015 зелёные
- [X] T017 [US2] `controller.ts`: `ring`/`accept` несут `caps: ["group"]`; `addHere(linkId)` — `accept` с `group` и `keys` текущих участников, `intro` (ключ нового) каждому текущему, затем `roster`; приём `intro`/`keys` → `contactIntroduce` → `refreshKeys`; `pending` → `hooks.newKey`, связь не устанавливается
- [X] T018 [US2] `controller.ts`: связи внутри группы по R5 — для каждого участника состава без связи, если `initiator` — я, `ring` с `auto: true` и `group`, повтор каждые 2 с до `accept`, ≤ 15 с; входящий `auto` своей группы от участника состава — принять без окна; связь после `accept` — как в звонке вдвоём
- [X] T019 [US2] `controller.ts`: `invite(channelId, userId)` — исходящий во время звонка: `ring` с `group` и `keys`; участник без `caps` при групповом звонке (известно по прошлым сообщениям) — не звонить, «у X старая версия P2PCall»; `accept` без `caps`, когда звонок групповой, — `bye` этой связи и то же сообщение; при 5 участниках — отказ с пояснением
- [X] T020 [US2] `ui/IncomingCallModal.tsx`: «Добавить сюда» (недоступна при 5 участниках, с подсказкой); для входящего с `group` — «групповой звонок: A, B»; `ui/HeaderCallButton.tsx`: во время звонка — «Добавить в звонок» → `invite`
- [X] T021 [US2] `ui/CallArea.tsx`, `ui/Tile.tsx`, `styles.css`: сетка плиток на 3–5 участников (2 — как сейчас), у плитки имя, аватар, индикатор речи, видео, «нет связи» для `lost`
- [X] T022 [P] [US2] `ui/Contacts.tsx`: у устройства по представлению — «получен через X»

**Checkpoint**: втроём слышат друг друга (quickstart 4, 5).

---

## Phase 5: User Story 3 — состав виден всем (P1)

**Goal**: «X теперь в звонке» у всех, звонок виден в ЛС с каждым участником.

**Independent Test**: quickstart 6.

- [X] T023 [US3] `controller.ts`: `roster` — при любом изменении состава всем по связям и при установке каждой связи; приём → `mergeRoster`, новые участники → T018; уведомление `hooks.info("X теперь в звонке")` по разнице составов; лог `[P2PCall] group` с составом
- [X] T024 [US3] `state.ts`/`index.tsx`: `areaVisible` — звонок виден в ЛС с любым участником состава, ЛС с которым есть в `dmPeers()`, иначе в ЛС с добавившим (`by`); тест в `state.test.ts`

---

## Phase 6: User Story 4 — уход из группового звонка (P1)

**Goal**: уход одного не рвёт звонок остальным; пропавший исчезает ≤ 15 с.

**Independent Test**: quickstart 7, 8.

- [X] T025 [P] [US4] Тесты в `group.test.ts`: `here` обновляет `lastHere`; функция `stale(group, links, now)` — участник без `here` 15 с → надгробие; участник с `here`, но со связью `lost`, остаётся
- [X] T026 [US4] `controller.ts`: `here` всем по связям раз в 5 с; проверка `stale` раз в секунду → закрыть связь, надгробие, «X вышел»; `hangup` в группе → `leave` всем + закрыть связи; приём `leave` → надгробие, связь закрыть, «X вышел»; `bye` закрывает связь, не группу; `isAlone` → звонок завершён как сейчас (`ended`)
- [X] T027 [US4] `controller.ts`: ICE `failed` у связи в группе (3+) не завершает звонок — связь закрывается, участник остаётся в составе (плитка «соединение…»), инициатор по R5 устанавливает её заново через ≥ 5 с; вдвоём — как сейчас (`ice-failed` + подсказка UPnP)

---

## Phase 7: User Story 5 — демка в групповом звонке (P2)

**Goal**: демка доходит до всех, голос в приоритете.

**Independent Test**: quickstart 9.

- [X] T028 [P] [US5] Тест в `streamQuality.test.ts`: `perReceiverBitrate(qualityBps, receivers)` = `quality / receivers`, не ниже 1,5 Мбит/с; 1 получатель — без изменений
- [X] T029 [US5] `session.ts`/`streamQuality.ts`: `RTCRtpSender` звука `priority`/`networkPriority: "high"`, видео `"low"`; `setScreenQuality(q, receivers)` ставит `maxBitrate` по `perReceiverBitrate`; контроллер пересчитывает при изменении числа связей
- [X] T030 [US5] `controller.ts`/`ui/Tile.tsx`: несколько демок одновременно — у каждого участника своя плитка с демкой; клик по плитке — крупно

---

## Phase 8: Polish

- [X] T031 [P] `docs/p2pcall-connect.md`: раздел о групповых звонках (добавить, уйти, предел 5, старые версии, «получен через X»); `docs/p2pcall-todo.md`: пункты групповых звонков и бага «входящий во время звонка» — отметить, шаг 2 дорожной карты — `[~]`
- [X] T032 Полный прогон: `npx tsx --test src/userplugins/p2pCall/*.test.ts`, `pnpm testTsc`, `pnpm lint` по плагину
- [ ] T033 Живая проверка втроём по `quickstart.md` (1–10), результаты — в `quickstart.md` (ишью: https://github.com/Shura4eburek/Vencord/issues/1)

---

## Dependencies

- Phase 2 (T001–T006) → все истории. T004 → T005 → T006. T001 → T002.
- US1 (T007–T011) — после T005; от US2–US5 не зависит.
- US2 (T012–T022) — после US1 (T010 → T020). T012 → T013 → T014; T015 → T016 → T017 → T018 → T019.
- US3 (T023–T024) — после T018.
- US4 (T025–T027) — после US3.
- US5 (T028–T030) — после T005 и T021.
- Polish — последним.

## Parallel Examples

- Phase 2: T001+T002 ∥ T003 ∥ T004 (разные файлы).
- US2: T012/T013 ∥ T015/T016 ∥ T022.
- US5: T028 ∥ T025.

## Implementation Strategy

1. **MVP**: Phase 2 + US1 — баг «занят молча» закрыт, звонок вдвоём не изменился; можно выпустить релиз.
2. US2 + US3 — групповые звонки; релиз и проверка втроём.
3. US4, US5 — устойчивость и демка.
4. Polish, `/speckit-converge`, `/code-review`.

---

## Phase 9: Convergence

- [X] T034 `ui/IncomingCallModal.tsx`: Esc отклоняет только верхнее (последнее открытое) окно входящего, остальные остаются per Edge Cases «несколько входящих» (contradicts)
- [X] T035 `ui/CallArea.tsx`/`ui/Tile.tsx`: клик по плитке участника разворачивает её крупно в области звонка, повторный клик — обратно к сетке per T030 (partial)
- [X] T036 `controller.ts`: лог `[P2PCall] link` при каждом переходе фазы связи (`link`, `peer`, `phase`, `reason`, `auto`/`invite`) per quickstart «Логи» (partial)
