# Implementation Plan: групповые звонки P2PCall

**Branch**: `feat/p2p-call` | **Date**: 2026-10-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-group-calls/spec.md`

## Summary

Звонок разделяется на **группу** (состав, сходящийся у всех без координатора) и **связи** — пару
«я ↔ участник» со своей `Session`, туннелем и комнатой сигналинга (mesh до 5 человек). Существующий
автомат вызова (`state.ts`) остаётся для первого звонка и каждого приглашения; входящий во время звонка
становится приглашением с окном «Отклонить / Положить текущий и принять / Добавить сюда» вместо
молчаливого `busy`. Участники, которые не контакты друг друга, получают ключи друг друга от добавившего
(представление поверх ключей `003`). Демка: один захват, потолок битрейта делится на получателей, звук в
приоритете. Решения — [research.md](research.md), протокол — [contracts/group-signaling.md](contracts/group-signaling.md).

## Technical Context

**Language/Version**: TypeScript, сборка Vencord; Electron main + renderer Discord

**Primary Dependencies**: без новых — WebRTC Chromium, `nostr-tools`, `@noble/*` (как в `003`)

**Storage**: книга контактов `003` (+ поле `via` у устройства); группа — только в памяти

**Testing**: `node:test` + `tsx --test`; чистые модули (`group.ts`, `state.ts`, `contacts.ts`) — юнит-тесты;
живая проверка втроём по [quickstart.md](quickstart.md)

**Target Platform**: Discord для Windows с Vencord

**Project Type**: плагин клиентского мода

**Performance Goals**: добавленный участник слышит всех ≤ 10 с; состав сходится ≤ 3 с; окно входящего ≤ 2 с

**Constraints**: без серверов медиа и координатора; звонок вдвоём не меняется (SC-007); совместимость со
старой версией для звонка вдвоём; аплинк ≥ 10 Мбит/с для демки на 5

**Scale/Scope**: до 5 участников (4 связи на клиента), до 4 туннелей одновременно

## Constitution Check

Шаблон конституции без принципов — гейтов нет. Особое внимание в финальном ревью: доверие к ключам по
представлению (R4) и сходимость состава (R6). Нарушений нет.

## Project Structure

```text
specs/004-group-calls/   plan.md research.md data-model.md quickstart.md contracts/group-signaling.md tasks.md

src/userplugins/p2pCall/
├── group.ts / group.test.ts       # НОВЫЕ: состав, mergeRoster, предел 5, кто начинает связь, конец звонка
├── link.ts                        # НОВЫЙ: PeerLink — Session + туннель + audio/meter одной связи (из controller)
├── state.ts / state.test.ts       # ring во время звонка → приглашение; auto-связи; busy только для чужих/6-го
├── controller.ts                  # Map<userId, PeerLink>, группа, приглашения, invite/addHere/replace, here/leave
├── signaling.ts / .test.ts        # новые типы и поля (caps, group, keys, intro, roster, here, leave)
├── session.ts                     # приоритет отправителей; потолок битрейта демки по числу получателей
├── contacts.ts / contacts.test.ts # устройство по представлению (via), правило смены ключа
├── native.ts                      # IPC contactIntroduce; contactsList отдаёт via
├── net.ts                         # Map туннелей по linkId, список зависших пробросов
├── ui/IncomingCallModal.tsx       # три кнопки во время звонка, «групповой звонок: …», «Добавить сюда» ≤ 5, Esc
├── ui/CallArea.tsx, ui/Tile.tsx   # сетка плиток на всех участников, «нет связи», индикатор речи
├── ui/HeaderCallButton.tsx        # во время звонка — «добавить в звонок»
├── ui/Contacts.tsx                # «получен через X»
└── index.tsx                      # areaVisible по составу, уведомления «X в звонке / вышел»
docs/p2pcall-connect.md, docs/p2pcall-todo.md
```

**Structure Decision**: всё в существующем плагине `src/userplugins/p2pCall`; логика, которую можно
проверить без Discord, — в чистых модулях с тестами рядом, как в `001`–`003`.

## Порядок работ (для tasks)

1. **US1 (баг)**: приглашения в `state.ts`/`controller.ts` + окно — работает и без групп.
2. **Фундамент**: `group.ts`, `link.ts` (вынос связи из контроллера без изменения поведения вдвоём),
   `net.ts` на несколько туннелей.
3. **US2/US3**: представление ключей, `intro`/`roster`/`link`, сетка плиток, видимость в ЛС.
4. **US4**: `here`/`leave`, надгробия, конец при одном.
5. **US5**: демка — приоритеты и делёж битрейта.
6. Документация, живая проверка втроём.

## Complexity Tracking

| Решение | Зачем | Почему не проще |
|---|---|---|
| Состав как CRDT с надгробиями | нет «главного», одновременные изменения | состав у добавившего — рушится при его уходе |
| `here` по сигналингу | отличить «ушёл» от «нет связи с одним» | по ICE — ложные уходы при частичной связности |
