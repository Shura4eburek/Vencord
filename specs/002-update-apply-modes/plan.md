# Implementation Plan: обновления P2PCall без лишних перезапусков

**Branch**: `feat/p2p-call` | **Date**: 2026-10-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-update-apply-modes/spec.md`

## Summary

Релиз собирается детерминированно (фиксированные метки сборки), поэтому неизменённые файлы совпадают
байт в байт. Автообновление сравнивает sha256 файлов на диске с подписанным `manifest-v2.json`, качает
только изменившиеся и по таблице «файл → часть» выдаёт итог: ничего / перезагрузить окно /
перезапустить Discord. Туннель и UPnP выносятся в отдельный бандл `p2pcall-net.js`, который `native.ts`
перезагружает между звонками — их правки не требуют действий. Во время звонка рендерер откладывает
уведомление. Подробности — [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript, сборка Vencord (esbuild); Electron main + renderer Discord

**Primary Dependencies**: существующие `updateRun.ts`/`updateLogic.ts` (ed25519 + sha256), `require` Node для модуля; новых зависимостей нет

**Storage**: файлы в `dist` (как сейчас); флаги «нужен перезапуск/перезагрузка» — в памяти main

**Testing**: `node:test` + `tsx --test`; temp-dist с фейковым `fetch` для `applyUpdate` (как текущие `updateRun.test.ts`)

**Target Platform**: Discord для Windows с Vencord, установленный из zip/релиза

**Project Type**: плагин клиентского мода

**Performance Goals**: перезагрузка окна ≤ 5 с; подмена сетевого модуля < 100 мс между звонками

**Constraints**: старые установки продолжают обновляться; подпись не слабее текущей; ни одного прерванного звонка

**Scale/Scope**: 5 файлов сборки, 3 части

## Constitution Check

Конституция — нератифицированный шаблон, гейтов нет. Правила репозитория соблюдаются (стиль, тесты рядом,
без новых зависимостей). Нарушений нет.

## Project Structure

```text
specs/002-update-apply-modes/   plan.md research.md data-model.md quickstart.md contracts/update.md tasks.md

src/userplugins/p2pCall/
├── net.ts                 # НОВЫЙ: оркестрация туннеля (из native.ts) + createNet({ userData })
├── netLoader.ts           # НОВЫЙ: загрузка/перезагрузка dist/p2pcall-net.js по mtime, broken-флаг (без Electron)
├── netLoader.test.ts      # НОВЫЙ
├── native.ts              # tunnel* → обёртки над netLoader; pending restart/reload; did-navigate
├── updateLogic.ts         # UPDATE_FILES_V2, PART_OF, Action, strongest, parseManifestV2
├── updateLogic.test.ts
├── updateRun.ts           # manifest-v2, качать только изменившиеся, итог + pending; немедленная проверка без net-модуля
├── updateRun.test.ts
├── updater.tsx            # три текста/кнопки, reload окна, откладывание на время звонка
├── index.tsx              # передать в updater состояние звонка контроллера
└── tools/release.ts       # сам собирает с фиксированными метками; оба манифеста; zip с 5 файлами
scripts/build/build.mjs    # + бандл p2pcall-net.js, если есть src/userplugins/p2pCall/net.ts
docs/p2pcall-connect.md    # раздел про обновления
```

**Structure Decision**: сетевая часть уходит в отдельный бандл, но исходники остаются в папке плагина;
`netLoader` без Electron, чтобы тестироваться под голым Node.

## Phases (для `/speckit-tasks`)

1. **Логика частей** — `updateLogic`: таблица, `strongest`, `parseManifestV2` + тесты.
2. **Сетевой модуль** — `net.ts` (перенос из `native.ts`), запись в `build.mjs`, `netLoader` + тесты, обёртки
   в `native.ts`. Проверка: `pnpm build` даёт `dist/p2pcall-net.js`, звонок/туннель работают как раньше.
3. **Применение обновления** — `updateRun`: v2-манифест, сравнение с диском, частичная загрузка, итог,
   pending в памяти, немедленная проверка без net-модуля + тесты.
4. **Показ** — `updater.tsx`: тексты/кнопки, reload, откладывание во время звонка.
5. **Релиз** — `release.ts`: детерминированная сборка, оба манифеста, zip с 5 файлами; доки.
6. Живая проверка по quickstart.

## Risks

| Риск | Что делаем |
|---|---|
| Чужой код Vencord в `patcher.js` недетерминирован в другой среде | сборка только через `release.ts` на одной машине; тест в quickstart №1 сразу покажет `restart` вместо `reload` |
| `require` модуля из `dist` блокирует файл на Windows при подмене | подмена через `rename` поверх; Node читает файл целиком и не держит дескриптор |
| Ctrl+R окна во время звонка (кнопка нажата позже) | кнопка появляется только вне звонка (R5) |

## Complexity Tracking

Нарушений нет.
