---

description: "Task list for P2PCall call redesign"
---

# Tasks: редизайн P2P-звонка под Discord

**Input**: Design documents from `specs/005-call-redesign/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui.md, quickstart.md

**Tests**: включены — их требует quickstart: `tabs.test.ts`, `tileColor.test.ts`, `patches.test.ts`, `icons.test.ts`.

**Эталон**: дизайн-система «P2P-звонок» (https://claude.ai/artifact/9JQBnvrH84Lg2eXRR6Awvn): `project/components/bundle.css`, README компонентов, строки `d` иконок в `project/README.md`.

Пути — относительно `src/userplugins/p2pCall/`, если не указано иное.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

Новых зависимостей нет — фаза пустая.

---

## Phase 2: Foundational (блокирует все истории)

- [X] T001 [P] Заменить в `ui/icons.tsx` пути на строки `d` из README дизайн-системы (R9).
  - Сохранить хелпер `svg()` и имена экспортов `MicIcon`, `MicOffIcon`, `HeadphonesIcon`, `HeadphonesOffIcon`, `CameraIcon`, `CameraOffIcon`, `ScreenIcon`, `ScreenOffIcon` (= `screen-stop`), `HangupIcon`.
  - `PhoneLinkIcon` становится иконкой `p2p-call`.
  - Добавить `ChevronDownIcon`, `AddUserIcon`, `GridIcon`, `FocusIcon`, `FullscreenIcon`, `SignalIcon`, `PhoneIcon`.
  - Обновить `icons.test.ts`: каждый путь непустой, без `NaN`.
- [X] T002 [P] Тесты `tileColor.test.ts`:
  - `averageColor` у равномерной картинки возвращает её цвет `#rrggbb`;
  - пиксели с альфой < 128 не учитываются;
  - если непрозрачных пикселей < 10%, результат `null`;
  - `accentToHex(0xff0000)` возвращает `"#ff0000"`.
- [X] T003 [P] `tileColor.ts`:
  - чистые `averageColor(pixels)` и `accentToHex(int)`;
  - `useTileColor(userId)`: сначала `UserProfileStore.getUserProfile(id)?.accentColor`, иначе средний цвет аватарки (`img.crossOrigin="anonymous"`, canvas 16×16), иначе `null`;
  - кэш `Map<avatarUrl, string|null>`.
  
  Тесты T002 должны пройти.
- [X] T004 Переписать `styles.css` по `bundle.css` дизайн-системы (R10).
  - Не переносить `[data-p2p-tip]`.
  - У `.p2p-area` убрать фиксированный `height`.
  - Добавить `.p2p-area:fullscreen{height:100%!important}` и скрыть в нём `.p2p-resize`.
  - Добавить `.p2p-native-wrap{position:relative}` и `.p2p-tabs-float{position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:…}`.
  - Классы, которых нет в дизайн-системе, сохранить для компонентов, которые не переделываются: модалки контактов, выбор источника, качество в настройках.
  - Старые классы области и панели удалить в T022.

**Checkpoint**: иконки и стили на месте, сборка зелёная.

---

## Phase 3: User Story 2 — область как звонок Discord (P1) 🎯 MVP

**Goal**: шапка, плитки, раскладки, фокус, состояния, статистика — по дизайн-системе.

**Independent Test**: звонок вдвоём и втроём совпадает с макетом (quickstart 1–4).

- [X] T005 [US2] Новая разметка `ui/Tile.tsx`:
  ```
  .p2p-tile[style=--p2p-banner] > .p2p-tile-center > .p2p-avatar > img
  .p2p-badge (mic-off | headphones-off)
  .p2p-name
  ```
  - Состояния: `p2p-speaking`, `p2p-ringing` + `.p2p-caption` «Вызов…», `p2p-nolink` + спиннер «соединение…».
  - `p2p-has-video` + `<video class="p2p-video">`; пока поток без видеотрека, показывать аватарку.
  - Новый проп `live` даёт плашку `.p2p-live` «В эфире».
  - Новый проп `small` — для полосы фокуса.
  - Цвет плитки — `useTileColor`.
  - Сохранить `tabindex=0`, `role=button` и двойной клик по видео на весь экран.
- [X] T006 [US2] `ui/CallArea.tsx` — шапка `.p2p-header`.
  - Слева: проп `tabs` и `.p2p-title` с `PhoneIcon` и названием: «Имя» или «Групповой звонок · N».
  - Справа, только в группе: кнопка `.p2p-icon-btn` «Сетка» / «Фокус» (`GridIcon` / `FocusIcon`).
  - Тултип — `Tooltip` Discord.
- [X] T007 [US2] `ui/CallArea.tsx` — сцена `.p2p-stage`.
  - `.p2p-grid[data-count]` на всех, включая себя.
  - Фокус: `.p2p-focus` > `.p2p-focus-main` + `.p2p-strip` с `small`-плитками. Клик по большой плитке или «Сетка» возвращает сетку.
  - Состояния звонка через `.p2p-state`:
    - «Вызов…» — аватарка собеседника с `.p2p-pulse`;
    - «Соединение…» — `.p2p-state-sub` со спиннером;
    - `END_TEXT[reason]`.
  - `.p2p-stats` вместо `.p2p-chip` (те же строки); пинг подсвечен `.p2p-stats-ok`.
  - Ручка высоты `.p2p-resize`: `.p2p-resizing` на время перетаскивания, пределы прежние.

**Checkpoint**: область выглядит по макету; управление пока старое.

---

## Phase 4: User Story 3 — панель управления (P1)

**Goal**: круглые кнопки Discord, шевроны устройств, поповер демки, «Добавить», «На весь экран».

**Independent Test**: quickstart 4–8, 12, 16.

- [X] T008 [US3] `controller.ts`: `setDevice(kind: "audioinput"|"audiooutput"|"videoinput", id)` по contracts/ui.md.
  - Пишет `settings.store`.
  - **Ввод**: новый `getMic` → `setTrackAll("mic")`; старый трек остановить; mute сохранить; `micReady` и `LocalAudio`/метр речи перевести на новый поток.
  - **Камера**: если включена — переснять и `setTrackAll("cam")`.
  - **Вывод**: `setSinkId` у `<audio>` всех связей.
  - Ошибку захвата логировать `[P2PCall] device`, старый трек оставить.
- [X] T009 [P] [US3] `ui/DeviceMenu.tsx`.
  - `openDeviceMenu(e, c, "audio" | "video")` — `ContextMenuApi.openContextMenu` + `Menu.Menu`:
    - группа «Устройство ввода», группа «Устройство вывода» (`MenuRadioItem` по `enumerateDevices`, «По умолчанию» = `""`), `MenuCheckboxItem` «Выключить звук» → `c.toggleDeafen()`;
    - для видео — группа «Камера».
  - `openAddMenu(e, c)`: до 10 последних ЛС 1-на-1, кроме участников звонка и `addBlocked` → `c.dial(channelId, recipientId)`. Если таких нет, пункт «Нет собеседников» (disabled).
- [X] T010 [P] [US3] `ui/StreamQualityMenu.tsx` переделать в поповер `.p2p-popover` внутри `.p2p-popover-anchor`.
  - Разрешение `.p2p-seg` 720p/1080p/1440p и fps 30/60, выбранное — `.p2p-selected`.
  - Если демка не идёт — «Начать демонстрацию»; если идёт — «Остановить» и «Применить».
  - Закрывается кликом мимо и Esc.
  - Логику качества (`settings`, `c.setScreenQuality` или текущий аналог) не менять.
- [X] T011 [US3] `ui/ControlBar.tsx` — `.p2p-controls` с тремя колонками.
  - **Слева**: `.p2p-ctrl-sm` «Добавить в звонок» → `openAddMenu`.
  - **Центр**:
    - `.p2p-ctrl-group` камера + `.p2p-ctrl-chevron` → `openDeviceMenu(video)`;
    - демка: `.p2p-ctrl-on` + `ScreenOffIcon`, когда идёт; клик без демки → `pickSource`, с демкой → поповер T010;
    - `.p2p-ctrl-group` микрофон (`.p2p-ctrl-off` при выключенном) + шеврон → `openDeviceMenu(audio)`;
    - `.p2p-ctrl-danger` «Отключиться».
  - **Справа**: «На весь экран» / «Выйти из полноэкранного режима» — `requestFullscreen` на `.p2p-area`, состояние по `fullscreenchange`.
  - Тултипы по README ControlBar, через `Tooltip`.
  - До `connected` — только «Отключиться».
  - Подключить в `CallArea` вместо старых `.p2p-controls`; не рендерить в фазе `ended`.

**Checkpoint**: все функции звонка доступны с новой панели (FR-009).

---

## Phase 5: User Story 1 — вкладки (P1)

**Goal**: одна область с вкладками, когда в ЛС идут оба звонка.

**Independent Test**: quickstart 9–11.

- [X] T012 [P] [US1] Тесты `tabs.test.ts`:
  - `pickTab` без одного из звонков возвращает `null`;
  - без выбора — вкладка с бо́льшим `seen`, при равенстве `"p2p"`;
  - ручной выбор держится;
  - `trackSeen` ставит время при первом появлении, обнуляет при пропаже и сбрасывает `pick`.
- [X] T013 [P] [US1] `tabs.ts`: `TabSeen`, `pickTab(seen, pick)`, `trackSeen(channelId, discord: boolean, p2p: boolean, now)`, `setPick(channelId, tab)`; хранилище — модульные `Map` по data-model. Тесты T012 должны пройти.
- [X] T014 [US1] `patches.ts`: `CALL_AREA_PATCH.replace` → `"$self.renderCallArea(this.props.channel,this.props.height,()=>this.renderCall()),"`. В `patches.test.ts`: после замены `this.renderCall()` встречается ровно один раз и только внутри `()=>`; `renderEmbeddedActivityPanel` не тронут.
- [X] T015 [US1] `ui/Tabs.tsx`: `.p2p-tabs`, `role=tablist`, две `.p2p-tab`; активная — `.p2p-tab-active`, `aria-selected`.
  - Индикатор `.p2p-tab-ind`: `.p2p-dot`, `count`, `MicIcon` при `speaking`.
  - Discord-индикатор: `useStateFromStores([VoiceStateStore, SpeakingStore])` по `channelId`.
  - P2P-индикатор: из `useCallView`.
  - Проп `float` добавляет класс `.p2p-tabs-float`.
- [X] T016 [US1] `ui/CallSlot.tsx` по таблице contracts/ui.md.
  - `native = renderNative()`; `trackSeen` на каждый рендер, в эффекте.
  - Для `discord` — `.p2p-native-wrap` с плавающими `Tabs` и `native`.
  - Для `p2p` — `CallArea` с `tabs`.
  - `index.tsx`: `renderCallArea(channel, height, renderNative)`. Не ЛС или нет контроллера → `renderNative()`; иначе `ErrorBoundary` с `fallback={renderNative()}` вокруг `CallSlot`.

**Checkpoint**: два звонка — одна область, переключение без обрыва звука.

---

## Phase 6: User Story 4 — панель, входящий, кнопка в шапке (P2)

**Goal**: остальной UI по дизайн-системе, поведение прежнее.

**Independent Test**: quickstart 13–14.

- [X] T017 [P] [US4] `ui/ConnectedPanel.tsx` → `.p2p-panel`.
  - Первая строка: `SignalIcon` + «P2P подключено»; `.p2p-pending` с текстом «P2P · вызов…» или «P2P · соединение…».
  - Участники `.p2p-panel-sub`: «Имя», «Имя / Имя2», «Имя / Имя2 и ещё N»; клик открывает ЛС.
  - Справа: `.p2p-icon-btn` «Выключить звук» / «Включить звук» и «Отключиться» (`.p2p-danger`).
  - Ниже `.p2p-panel-actions`: «Видео» (камера) и «Экран» (`pickSource` / остановить), только после соединения.
  - Пинг и путь — в тултипе статуса.
- [X] T018 [P] [US4] `ui/IncomingCallModal.tsx` → `.p2p-incoming`.
  - Содержимое: аватарка `.p2p-avatar.p2p-pulse`, `.p2p-incoming-name` («Имя» или «Групповой звонок: A, B»), `.p2p-incoming-sub`.
  - Вне звонка — круглые `.p2p-ctrl` «Отклонить» (danger + hangup), «Принять» (positive + phone), «С видео» (positive + camera), с подписями `.p2p-incoming-act`.
  - Во время звонка — `.p2p-incoming-list` из `.p2p-btn`: «Отклонить», «Положить текущий и принять», «Добавить сюда».
  - Модалка остаётся `ModalRoot` Discord. Логику окон (одно на `linkId`, Esc, `openOrder`) не менять.
- [X] T019 [P] [US4] `ui/HeaderCallButton.tsx`: иконка `PhoneLinkIcon` (`p2p-call`); тултипы прежние. Во время звонка иконка зелёная — `color` = `var(--status-positive)`, если `HeaderBar.Icon` принимает `color`, иначе класс `p2p-in-call` на обёртке.

**Checkpoint**: весь UI по дизайн-системе.

---

## Phase 7: Polish

- [X] T020 [P] Grep по `ui/`, `index.tsx`, `styles.css`: каждый `className` есть в CSS; ни одного класса без префикса `p2p-`.
- [X] T021 [P] `docs/p2pcall-connect.md`: раздел про вкладки и обёртку `renderCall` (что делать, если Discord сменил разметку). `docs/p2pcall-todo.md`: отметить редизайн.
- [X] T022 Удалить из `styles.css` и кода старые классы и компоненты, которых больше нет: `p2p-plaque*`, `p2p-tiles*`, `p2p-chip`, старые `p2p-ctrl-*`, если не используются; `QualityControls.tsx`, если его заменил поповер.
- [X] T023 Проверки: `npx tsx --test src/userplugins/p2pCall/*.test.ts`, `pnpm testTsc`, `pnpm lint`, `pnpm build`. Новые файлы добавить через `git add -f`.
- [ ] T024 Живая проверка по `quickstart.md` 1–16 и сценариям specs/004 (SC-004); результат — в issue проверки.

---

## Dependencies & Execution Order

- **Phase 2** блокирует всё. T001, T002–T003 и T004 можно делать параллельно.
- **US2** (T005–T007) — после Phase 2.
- **US3**:
  - T008, T009 и T010 параллельны;
  - T011 — после них и после T007.
- **US1**:
  - T012–T013 параллельны с US2 и US3;
  - T014–T016 — после T006, потому что вкладки встраиваются в шапку.
- **US4** (T017–T019) — после Phase 2, независимо от остальных.
- **Polish** — последним.

## Parallel Example

```text
T001 icons.tsx | T002+T003 tileColor | T004 styles.css | T012+T013 tabs.ts
затем: T005 → T006 → T007 | T008 | T009 | T010 | T017 | T018 | T019
```

## Implementation Strategy

1. **MVP**: Phase 2 + US2 — новый вид области при старой панели.
2. Затем US3, потом US1 (вкладки) и US4.
3. После каждой фазы — сборка и `testTsc`.
4. Выпуск — после живой проверки.
