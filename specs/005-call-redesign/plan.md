# Implementation Plan: редизайн P2P-звонка под Discord

**Branch**: `feat/p2p-call` | **Date**: 2026-10-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/005-call-redesign/spec.md`

## Summary

Интерфейс плагина перевёрстывается по дизайн-системе «P2P-звонок»: CSS из `bundle.css`, 21 иконка, разметка компонентов из README дизайн-системы. Логика звонка не меняется.

Новое по поведению — три вещи:
- **Вкладки.** Патч области звонка теперь заворачивает `renderCall()` Discord. Наш `CallSlot` показывает либо один звонок, либо вкладки «Звонок Discord» / «P2P», а неактивный звонок не рендерит.
- **Меню устройств.** Устройства можно менять посреди звонка.
- **«Добавить в звонок»** из панели управления.

Решения описаны в [research.md](research.md), контракт патча и компонентов — в [contracts/ui.md](contracts/ui.md).

## Technical Context

**Language/Version**: TypeScript, сборка Vencord; renderer Discord

**Primary Dependencies**: без новых. Используются `@webpack/common`: `Tooltip`, `Menu`, `ContextMenuApi`, `UserStore`, `UserProfileStore`, `VoiceStateStore`, `ChannelStore`, `useStateFromStores`. Плюс `findStoreLazy("SpeakingStore")`.

**Storage**: активная вкладка хранится только в памяти; устройства — в `settings.store`, как сейчас.

**Testing**: `node:test` + `tsx --test`.
- Чистые функции покрыты юнит-тестами:
  - `tabs.ts` — выбор вкладки, индикатор;
  - `tileColor.ts` — средний цвет по пикселям;
  - `icons.test.ts`;
  - `patches.test.ts` — новая замена.
- Внешний вид и поведение проверяются вживую по [quickstart.md](quickstart.md).

**Target Platform**: Discord для Windows с Vencord

**Project Type**: плагин клиентского мода

**Performance Goals**: переключение вкладки ≤ 0,2 с; цвет плитки вычисляется один раз на аватарку (кэш).

**Constraints**:
- Звонок Discord нельзя ломать: при нашей ошибке рисуется его область.
- Только классы `p2p-*`.
- Цвета берутся из переменных темы.

**Scale/Scope**: 9 компонентов UI, около 450 строк CSS.

## Constitution Check

Конституция — шаблон без принципов, гейтов нет. Особое внимание в финальном ревью уделить двум вещам:
- обёртке `renderCall`: родной звонок Discord не должен пропадать ни при каких состояниях плагина;
- `setDevice` посреди звонка.

## Project Structure

```text
specs/005-call-redesign/   plan.md research.md data-model.md quickstart.md contracts/ui.md tasks.md

src/userplugins/p2pCall/
├── patches.ts / patches.test.ts   # CALL_AREA_PATCH заворачивает renderCall
├── index.tsx                      # renderCallArea(channel, height, renderNative): CallSlot + ErrorBoundary(fallback=native)
├── tabs.ts / tabs.test.ts         # НОВЫЙ: pickTab, firstSeen/pick по каналу, текст индикатора
├── tileColor.ts / .test.ts        # НОВЫЙ: средний цвет пикселей + кэш; accentColor профиля
├── controller.ts                  # setDevice(kind, id): ввод/камера/вывод посреди звонка
├── styles.css                     # переписан по bundle.css (R10)
└── ui/
    ├── icons.tsx                  # пути из дизайн-системы (R9)
    ├── CallSlot.tsx               # НОВЫЙ: один звонок / вкладки; плавающие вкладки над областью Discord
    ├── Tabs.tsx                   # НОВЫЙ: .p2p-tabs + индикаторы
    ├── CallArea.tsx               # шапка, сцена (сетка / фокус / состояние), статистика, ручка высоты, fullscreen
    ├── Tile.tsx                   # новая разметка плитки, --p2p-banner, «В эфире», бейджи
    ├── ControlBar.tsx             # НОВЫЙ: кнопки + шевроны + поповер демки + добавить/весь экран
    ├── DeviceMenu.tsx             # НОВЫЙ: контекстные меню устройств и «Добавить в звонок»
    ├── StreamQualityMenu.tsx      # → поповер .p2p-popover (720/1080/1440, 30/60, Применить/Остановить)
    ├── ConnectedPanel.tsx         # .p2p-panel: сигнал, участники, звук, сброс, «Видео», «Экран»
    ├── IncomingCallModal.tsx      # .p2p-incoming: пульс, кнопки / список во время звонка
    └── HeaderCallButton.tsx       # иконка p2p-call, зелёная во время звонка
```

**Structure Decision**: всё в существующем плагине. Логика, которую можно проверить без Discord, вынесена в чистые модули `tabs.ts` и `tileColor.ts`, тесты лежат рядом.

## Порядок работ (для tasks)

1. **Фундамент**: иконки, `styles.css` по дизайн-системе, `tileColor.ts`.
2. **US2**: `Tile`, `CallArea` — шапка, сетка, фокус, состояния, статистика.
3. **US3**: `ControlBar`, `DeviceMenu`, поповер демки, `controller.setDevice`, «Добавить в звонок», «На весь экран».
4. **US1**: патч `renderCall`, `CallSlot`, `Tabs`, `tabs.ts`.
5. **US4**: `ConnectedPanel`, `IncomingCallModal`, `HeaderCallButton`.
6. Удаление старых классов, документация, живая проверка.

US1 идёт после US2, потому что вкладки встраиваются в шапку новой области.

## Complexity Tracking

Нарушений нет.
