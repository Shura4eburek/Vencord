---

description: "Task list for UDP tunnel with UPnP port mapping"
---

# Tasks: UDP-туннель с автопробросом порта (UPnP)

**Input**: Design documents from `specs/001-udp-tunnel-upnp/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/tunnel.md, quickstart.md

**Tests**: включены — план и quickstart требуют `tunnelWire.test.ts`, `tunnel.test.ts`, `upnp.test.ts`, кейс в `stats.test.ts`.

Пути ниже — относительно `src/userplugins/p2pCall/`, если не указано иное.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Ручная проверка риска R1 в консоли Discord: `RTCPeerConnection` принимает удалённый кандидат `typ host` на собственный LAN-IP и шлёт на него STUN (UDP-эхо через временный обработчик в `native.ts`, после проверки удалить). Итог записать в `specs/001-udp-tunnel-upnp/research.md` (R1: подтверждено или переход на `127.0.0.1`)

---

## Phase 2: Foundational (блокирует все истории)

- [X] T002 [P] Тесты формата пакета в `tunnelWire.test.ts`: заголовок `P2T1`/token/path/kind, отбраковка без magic и с коротким буфером, keepalive-маска, классификатор RFC 7983 (STUN/DTLS/RTP), строка ICE-кандидата с приоритетом relay-уровня
- [X] T003 [P] Реализовать `tunnelWire.ts` по `contracts/tunnel.md` §3–4 (без Electron/Node-зависимостей, `Buffer.subarray` без копий) — тесты T002 зелёные
- [X] T004 Добавить `"tun"` в `SignalType` и поля `addr`/`token`/`upnp` в `SignalMsg` в `signaling.ts`; тест в `signaling.test.ts`, что `tun` проходит шифрование и доставку как остальные сигналы

**Checkpoint**: формат и сигнал готовы.

---

## Phase 3: User Story 1 — звонок с собеседником у того же провайдера (P1) 🎯 MVP

**Goal**: звонок Mamoru ↔ друг соединяется напрямую через туннель с автопробросом.

**Independent Test**: quickstart, живая проверка шаги 1–5.

### Tests for User Story 1

- [X] T005 [P] [US1] Loopback-тесты в `tunnel.test.ts`: два `Tunnel` на `127.0.0.1`, «WebRTC» эмулируется UDP-сокетами, пишущими в прокси; эмуляция несимметричного маршрута (ответы приходят с другого порта через промежуточный сокет-ретранслятор); проверки: данные в обе стороны, чужой токен отброшен, после подтверждения маски данные только по рабочему `path`, STUN — всем источникам, медиа — одному, `close()` освобождает порты
- [X] T006 [P] [US1] Тесты в `upnp.test.ts` с подменой `dgram`/`http`: разбор SSDP-ответа (LOCATION), разбор XML IGD (`WANIPConnection:1|2`, `WANPPPConnection:1`, относительный `controlURL`), тело SOAP `AddPortMapping`/`DeletePortMapping`, код 725 → повтор с lease 0, 718 → другой порт, нет ответа SSDP → `no-igd`, HTTP-ошибка → `error` без исключения

### Implementation for User Story 1

- [X] T007 [US1] `tunnel.ts`: класс `Tunnel` (инъекция `dgram`) — туннельный сокет на заданном порту, прокси-сокет, STUN Binding к двум серверам (R5), punch/keepalive 1 с → 2 с, send-to-both с маской (R3), учёт источников прокси (R2), `status()` по `data-model.md`, `close()` — тесты T005 зелёные
- [X] T008 [US1] `upnp.ts`: определение LAN-IP маршрута по умолчанию, SSDP с привязкой к нему (1,5 с), IGD XML, `AddPortMapping` с портом 40000–40999 (до 5 попыток), продление каждые 5 мин, `DeletePortMapping` — тесты T006 зелёные
- [X] T009 [US1] `native.ts`: `tunnelPrepare`/`tunnelSetPeer`/`tunnelStatus`/`tunnelClose` по `contracts/tunnel.md` §2 поверх `Tunnel` и `upnp`; один активный туннель; `app.on("before-quit")` → закрыть и снять проброс
- [X] T010 [US1] `session.ts`: `addTunnelCandidate(ip, port)` — добавляет кандидат после первого `setRemoteDescription` и повторно после каждого ICE restart (новый remote ufrag)
- [X] T011 [US1] `controller.ts`: `tunnelPrepare` при входе в `outgoing`/`incoming`; при `start-session` и при готовности позже — сигнал `tun`; обработка входящего `tun` → `tunnelSetPeer` + `session.addTunnelCandidate`; `tunnelClose` на `leave-room`, `stop-session` и в `stop()`; ошибки IPC глушатся в лог (FR-009)
- [X] T012 [US1] Пересобрать (`pnpm build`), прогнать quickstart «Автотесты»

**Checkpoint**: MVP — живая проверка шагов 1–5 с другом.

---

## Phase 4: User Story 2 — обычные звонки не ухудшаются (P1)

**Goal**: туннель не влияет на звонки, где прямой путь работает, и молчит без UPnP.

**Independent Test**: quickstart, шаг 6; звонок при выключенном UPnP без всплывающих ошибок.

- [X] T013 [P] [US2] Тест в `tunnelWire.test.ts`: приоритет кандидата туннеля строго ниже любого `srflx`/`host` WebRTC (сравнение с формулой RFC 8445 для типов host/srflx)
- [X] T014 [US2] `controller.ts`: подготовка туннеля не задерживает `start-session` (не `await` в пути ICE); `tun` от собеседника без поддержки не ждём; старый собеседник (нет `tun`) — туннель закрывается через `ringTimeoutSec`/`iceTimeoutSec` без следов
- [X] T015 [US2] `upnp.ts`/`native.ts`: без IGD или при любой ошибке UPnP туннель всё равно поднимается (без проброса) и возвращает `upnp: "no-igd" | "error"`; никаких `warn`-тостов

---

## Phase 5: User Story 3 — подсказка, если туннель не помог (P2)

**Goal**: понятная причина при неудаче.

**Independent Test**: quickstart, шаг 7.

- [X] T016 [US3] `controller.ts` + `index.tsx`: при `ice-failed`/`ice-timeout` к `offerFallback` добавляется текст «Включите UPnP на роутере» (своя сторона `upnp ≠ ok`) или «У собеседника выключен UPnP на роутере» (из его `tun`)

---

## Phase 6: Polish & Cross-Cutting

- [X] T017 [P] `stats.ts` + `stats.test.ts`: `PathType` `"tunnel"`, когда удалённый кандидат выбранной пары = `lanIp:proxyPort`; чип/подпись в `ui/` — «напрямую (туннель)»
- [X] T018 [P] `controller.ts`: строка `[P2PCall] tunnel` в диагностический лог при подготовке, при получении `tun` и раз в 5 с вместе со `stats` (порт, UPnP, адреса, маска, rx/tx/dropped) — FR-012
- [X] T019 [P] `docs/p2pcall-connect.md` §5 и `docs/p2pcall-todo.md`: туннель вместо «решения на будущее», как проверить UPnP
- [X] T020 `npx tsx --test src/userplugins/p2pCall/*.test.ts`, `pnpm testTsc`, `pnpm lint` — всё зелёное
- [X] T021 Живая проверка по quickstart (шаги 1–8) с другом; результаты — в `quickstart.md`

---

## Dependencies & Execution Order

- T001 → всё остальное (определяет адрес кандидата).
- Phase 2 (T002–T004) → Phase 3.
- T005 ∥ T006 (разные файлы); T007 после T005, T008 после T006; T009 после T007+T008; T010 ∥ T009; T011 после T009+T010; T012 после T011.
- US2 (T013–T015) после T011; US3 (T016) после T011.
- Polish: T017–T019 параллельно после T011; T020 после всех кодовых задач; T021 последняя.

### Parallel Opportunities

```text
T002 ∥ T003-prep       # tunnelWire тесты и модуль — одна пара, но независима от signaling (T004)
T005 ∥ T006            # tunnel.test.ts и upnp.test.ts
T007 ∥ T008            # после своих тестов
T017 ∥ T018 ∥ T019     # stats/ui, лог, доки
```

## Implementation Strategy

1. **MVP**: Phase 1–3 → собрать, позвонить другу (quickstart 1–5). Если соединилось — главная цель достигнута.
2. Phase 4 — убедиться, что обычные звонки не пострадали (шаг 6), до релиза.
3. Phase 5–6 — подсказка, лог, доки, полный живой прогон, релиз.

---

## Phase 7: Convergence

- [X] T022 Снимать пробросы, оставшиеся после падения Discord: запоминать порт активного проброса в файле в `app.getPath("userData")` и при следующем `tunnelPrepare` удалять его через `DeletePortMapping` (постоянный проброс при коде 725 иначе живёт до перезагрузки роутера) в `native.ts` per FR-004 / Edge Cases «Discord упал» (partial)
- [X] T023 Писать итоговый `[P2PCall] tunnel` (статус туннеля + причина конца) при завершении звонка, а не только раз в 5 с в состоянии connected — иначе у несостоявшегося звонка в логе нет состояния туннеля, в `controller.ts` per FR-012 (partial)
- [X] T024 Сделать маску получаемых путей скользящей (пути, по которым пришли пакеты за последние ~6 с), чтобы отправитель ушёл с пути, переставшего работать посреди звонка, в `tunnel.ts` + тест в `tunnel.test.ts` per FR-005 (partial)
