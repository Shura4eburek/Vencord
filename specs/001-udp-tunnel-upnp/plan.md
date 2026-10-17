# Implementation Plan: UDP-туннель с автопробросом порта (UPnP)

**Branch**: `feat/p2p-call` | **Date**: 2026-10-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-udp-tunnel-upnp/spec.md`

## Summary

Звонок между абонентами одного CGNAT не проходит ICE из-за несимметричного маршрута и фильтра на
роутере. Добавляем в main-процесс плагина UDP-туннель: туннельный сокет на фиксированном порту,
открытом через UPnP, с отправкой на оба адреса собеседника и опознанием по токену, плюс локальный
прокси-сокет. WebRTC получает дополнительный низкоприоритетный ICE-кандидат на собственный LAN-адрес
ПК и порт прокси — для него собеседник «локальный», а шифрование остаётся сквозным. Обычный путь ICE
не меняется и выигрывает, когда работает. Подробности решений — [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript (сборка Vencord, esbuild), Node из Electron Discord (main) + Chromium 148 (renderer)

**Primary Dependencies**: Node `dgram`, `http`, `os` (main); WebRTC `RTCPeerConnection` (renderer); существующий сигналинг Nostr. Новых npm-зависимостей нет

**Storage**: N/A

**Testing**: `node:test` + `tsx --test` (как существующие `*.test.ts`), `pnpm testTsc`; живой тест по [quickstart.md](quickstart.md)

**Target Platform**: Discord для Windows с Vencord (обе стороны)

**Project Type**: плагин клиентского мода (desktop, renderer + native/main)

**Performance Goals**: туннель готов ≤ 3 с от начала звонка; пропускает демку 15 Мбит/с (~1500 пакетов/с в каждую сторону); добавочная задержка < 1 мс

**Constraints**: без настроек и платных сервисов; не замедлять обычный путь; проброс на роутере живёт не дольше звонка + 10 мин; старые версии плагина продолжают работать

**Scale/Scope**: 1:1 звонки, один туннель на звонок

## Constitution Check

`.specify/memory/constitution.md` — нератифицированный шаблон, принципов и гейтов нет. Проверки
следуют правилам репозитория: стиль окружающего кода, тесты рядом с модулем (`*.test.ts`), русские
комментарии, без новых зависимостей. Нарушений нет.

## Project Structure

### Documentation (this feature)

```text
specs/001-udp-tunnel-upnp/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/tunnel.md
└── tasks.md             # /speckit-tasks
```

### Source Code

```text
src/userplugins/p2pCall/
├── tunnelWire.ts        # НОВЫЙ: формат пакета, keepalive-маска, классификация RFC 7983, строка ICE-кандидата
├── tunnelWire.test.ts   # НОВЫЙ
├── tunnel.ts            # НОВЫЙ: Tunnel (туннельный сокет + прокси, send-to-both, источники, STUN); dgram инъецируется
├── tunnel.test.ts       # НОВЫЙ: два туннеля на 127.0.0.1 с эмуляцией несимметричного маршрута
├── upnp.ts              # НОВЫЙ: SSDP, разбор IGD, SOAP Add/DeletePortMapping, продление
├── upnp.test.ts         # НОВЫЙ: разбор ответов, коды 718/725 (http/dgram подменяются)
├── native.ts            # +tunnelPrepare/SetPeer/Status/Close, before-quit
├── signaling.ts         # SignalType += "tun", поля addr/token/upnp
├── session.ts           # addTunnelCandidate(), повтор после ICE restart
├── controller.ts        # жизненный цикл туннеля по фазам звонка, обработка "tun", лог, подсказка
├── stats.ts             # PathType "tunnel"
├── stats.test.ts        # +кейс tunnel
├── ui/…                 # подпись пути «напрямую (туннель)»
└── index.tsx            # текст подсказки UPnP в offerFallback
docs/p2pcall-connect.md  # §5: туннель вместо «решения на будущее»
docs/p2pcall-todo.md     # пункт про того же провайдера
```

**Structure Decision**: всё внутри существующего плагина; сетевое ядро (`tunnelWire`, `tunnel`,
`upnp`) без Electron-импортов, чтобы тестироваться под голым Node, а `native.ts` — тонкая обёртка.

## Phases (для `/speckit-tasks`)

1. **Wire** — `tunnelWire.ts` + тесты: кодирование/разбор заголовка, отбраковка, маска, классификатор, кандидат.
2. **Tunnel** — `tunnel.ts` + loopback-тесты: punch/keepalive, send-to-both → схождение по маске,
   источники прокси (STUN всем, медиа одному), STUN-адрес, закрытие. Это MVP-ядро US1.
3. **UPnP** — `upnp.ts` + тесты: SSDP с привязкой к LAN-IP, IGD XML, Add (725 → lease 0, 718 → другой
   порт), продление, Delete; сбой → `no-igd`/`error` без исключений наружу (FR-009).
4. **Интеграция** — `native.ts` IPC, `signaling` `tun`, `session.addTunnelCandidate`, контроллер
   (подготовка на `outgoing`/`incoming`, `tun` на `start-session`, закрытие на `leave-room`/`stop`).
5. **Наблюдаемость** — `PathType tunnel`, чип, `[P2PCall] tunnel` в лог, подсказка UPnP (US3).
6. **Доки** — `p2pcall-connect.md` §5, todo; затем живой тест по quickstart.

## Risks

| Риск | Что делаем |
|---|---|
| Chromium отвергнет удалённый кандидат на собственный LAN-IP | первая задача фазы 4 — ручная проверка в консоли Discord (два `RTCPeerConnection` + UDP-эхо в main); запасной вариант — кандидат на `127.0.0.1` |
| Роутер друга ответит на SSDP, но проброс не сработает из-за CGNAT | проброс нужен только на домашнем роутере (замер 05.10); STUN даёт реальный адрес |
| iceTimeoutSec 10 с не хватит | подготовка стартует во время звонка (ringing); при необходимости продлить ICE-таймер, пока туннель в процессе |
| main-процесс Discord подтормаживает на 1500 пакетов/с | замер CPU в живом тесте; буферы без копий (`Buffer.subarray`) |

## Complexity Tracking

Нарушений конституции нет.
