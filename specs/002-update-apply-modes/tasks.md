---

description: "Task list for update apply modes"
---

# Tasks: обновления P2PCall без лишних перезапусков

**Input**: Design documents from `specs/002-update-apply-modes/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/update.md, quickstart.md

**Tests**: включены — quickstart требует `updateLogic.test.ts`, `updateRun.test.ts`, `netLoader.test.ts`.

Пути — относительно `src/userplugins/p2pCall/`, если не указано иное.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 `tools/release.ts`: собирать самому (`pnpm build` с `SOURCE_DATE_EPOCH=1700000000`, `VENCORD_HASH=p2pcall`, `GIT_CONFIG_*` для safe.directory) и падать, если сборка не прошла — вместо ожидания готового `dist` (закрывает и вчерашний релиз со старым dist)

---

## Phase 2: Foundational

- [X] T002 [P] Тесты в `updateLogic.test.ts`: `PART_OF` для 5 файлов, `strongest([])="none"`, порядок none < reload < restart, `parseManifestV2` (ровно 5 файлов, `schema: 2`, лишние/недостающие → null), прежний `parseManifest` по-прежнему требует 4
- [X] T003 [P] `updateLogic.ts`: `UPDATE_FILES_V2`, `NET_FILE`, `Part`, `Action`, `PART_OF`, `ACTION_OF`, `strongest`, `parseManifestV2` по data-model — тесты T002 зелёные

---

## Phase 3: User Story 1 — обновление говорит, что делать (P1) 🎯 MVP

**Goal**: итог «ничего / перезагрузить окно / перезапустить Discord» по реально изменившимся файлам.

**Independent Test**: quickstart, ручная проверка 1–3.

### Tests for User Story 1

- [X] T004 [P] [US1] Тесты в `updateRun.test.ts` (temp-dist + фейковый `fetch`, подписанный тестовым ключом): изменился только `renderer.js` → `updated/reload`, скачан только он; только `p2pcall-net.js` → `none`; `patcher.js`+`renderer.js` → `restart`; ничего → `latest`; неверная подпись `manifest-v2` → `error`, файлы не тронуты; релиз без `manifest-v2` (старый) → прежний путь, `restart`

### Implementation for User Story 1

- [X] T005 [US1] `updateRun.ts`: `manifest-v2.json`/`.sig` → сравнить sha256 файлов на диске → скачать и проверить только изменившиеся → атомарная подмена → `{ status: "updated", action, changed }`; без v2 в релизе — прежняя логика с итогом `restart` — тесты T004 зелёные
- [X] T006 [US1] `native.ts`: в памяти main `pendingRestart` и окна, ждущие перезагрузки (`did-navigate` снимает); `checkForUpdate` возвращает `pending` (FR-010) и учитывает `netBroken` → `restart`
- [X] T007 [US1] `updater.tsx`: тексты и кнопки по `contracts/update.md` §3 (`none` без кнопки, `reload` → `location.reload()`, `restart` → `relaunchDiscord()`); `CheckNowButton` пишет тот же итог
- [X] T008 [US1] `tools/release.ts`: публиковать `manifest-v2.json`/`.sig` (schema 2, 5 файлов) рядом с прежними `manifest.json`/`.sig` (4 файла), ассет `p2pcall-net.js`; zip кладёт все 5 файлов

**Checkpoint**: релиз с правкой только `ui/` даёт «перезагрузи окно».

---

## Phase 4: User Story 2 — обновление не рвёт звонок (P1)

**Goal**: во время звонка ничего не перезагружается, действие предлагается после.

**Independent Test**: quickstart, ручная проверка 4.

- [X] T009 [US2] `updater.tsx` + `index.tsx`: `startUpdater` получает `inCall()` и подписку на конец звонка от `CallController`; итог во время звонка (`outgoing/incoming/connecting/connected`) откладывается и показывается при переходе в `idle`/`ended`; повторные отложенные итоги сливаются через `strongest`
- [X] T010 [US2] Тест в `updateLogic.test.ts` для чистой функции слияния отложенных итогов (`mergePending`) и правила «показывать сейчас / отложить» по фазе звонка

---

## Phase 5: User Story 3 — сетевая часть без перезапуска (P2)

**Goal**: правки туннеля/UPnP применяются без действий.

**Independent Test**: quickstart, ручная проверка 2 и 5.

### Tests for User Story 3

- [X] T011 [P] [US3] Тесты в `netLoader.test.ts` (temp-файл модуля): первая загрузка; новый `mtime` без активного туннеля → новый модуль, старый `dispose()`; с активным → старый остаётся; битый файл → старый модуль + `broken=true`; нет файла → `null`, `broken=false`

### Implementation for User Story 3

- [X] T012 [US3] `net.ts`: перенести оркестрацию туннеля из `native.ts` (`buildTunnel`, `closeActive`, stale-mapping, `isPeerAddr`-проверка, IGD-кэш) в `createNet({ userData })` с `hasActive()`/`dispose()`; без импортов Electron
- [X] T013 [US3] `netLoader.ts`: `loadNet(path, env)` по `stat` (mtime/size), очистка `require.cache`, `broken` — тесты T011 зелёные
- [X] T014 [US3] `scripts/build/build.mjs`: если есть `src/userplugins/p2pCall/net.ts` — бандл `dist/p2pcall-net.js` (`platform: node`, `format: cjs`, `external: ["electron"]`, те же define, что у main)
- [X] T015 [US3] `native.ts`: `tunnel*` → обёртки над `loadNet` (перезагрузка только внутри `tunnelPrepare`, после закрытия прошлого туннеля); `before-quit`/`did-navigate`/`render-process-gone` → `dispose`; `netBroken` наружу для T006
- [X] T016 [US3] `updateRun.ts`/`updater.tsx`: если `p2pcall-net.js` в `dist` нет (первый переход со старой версии) — проверка обновления сразу при старте, без 10 с ожидания
- [X] T017 [US3] `pnpm build`, звонок-регрессия: туннель работает как до переноса (лог `[P2PCall] tunnel`), `dist/p2pcall-net.js` создан

---

## Phase 6: Polish

- [X] T018 [P] `docs/p2pcall-connect.md`: раздел «Обновления» — три итога, что во время звонка, первый переход
- [X] T019 `npx tsx --test src/userplugins/p2pCall/*.test.ts`, `pnpm testTsc`, `npx eslint src/userplugins/p2pCall` — зелёные
- [ ] T020 Живая проверка по quickstart (ручные 1–5) на копии из zip

---

## Dependencies & Execution Order

- T001 → T008 (release). T002 ∥ T003 → всё остальное.
- US1: T004 → T005 → T006 → T007; T008 после T005.
- US2: T009, T010 после T007.
- US3: T011 → T013; T012 ∥ T011; T014 после T012; T015 после T013+T014; T016 после T005; T017 после T015.
- T006 читает `netBroken` из T015 — до T015 значение всегда `false`.
- Polish после всех.

### Parallel Opportunities

```text
T002 ∥ T003
T004 ∥ T011 ∥ T012
T018 ∥ T019
```

## Implementation Strategy

1. **MVP**: Phase 1–3 — три итога вместо вечного «перезапусти», уже экономит перезапуски на правках интерфейса.
2. US2 — защита звонка, до первого релиза с фичей.
3. US3 — сетевой модуль на лету; затем релиз (первый переход потребует перезапуска у всех) и живая проверка.
