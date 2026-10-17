# Contracts: UDP-туннель

## 1. Сигнал `tun` (Nostr, зашифрован, как остальные сигналы звонка)

```ts
{ type: "tun", callId, msgId, from, ts, addr: string | null, token: string, upnp: "ok" | "no-igd" | "error" }
```

Отправляется при `start-session` и повторно, если подготовка туннеля закончилась позже. Получатель
без поддержки туннеля игнорирует сообщение. Повторный `tun` с тем же `callId` обновляет адрес.

## 2. IPC (рендерер → main), `VencordNative.pluginHelpers.P2PCall`

| Функция | Вход | Выход | Поведение |
|---|---|---|---|
| `tunnelPrepare(callId)` | `string` | `{ addr, token, upnp, lanIp, proxyPort }` | идемпотентно для того же `callId`; новый `callId` закрывает старый туннель |
| `tunnelSetPeer(callId, peer)` | `{ addr, token }` | `void` | начинает punch/keepalive; чужой `callId` игнорируется |
| `tunnelStatus(callId)` | `string` | `TunnelStatus \| null` | для лога раз в 5 с и подсказки |
| `tunnelClose(callId)` | `string` | `void` | снимает UPnP-проброс, закрывает сокеты; идемпотентно |

Main дополнительно закрывает всё при `before-quit` и при выключении плагина.

## 3. Пакет туннеля (UDP, между туннельными сокетами)

```
 0      4                12   13   14
 | "P2T1" | token (8 B)  |path|kind| payload ...
```

- `token` — токен **отправителя**; получатель сверяет с токеном собеседника из `tun`.
- `path` — 0: отправлено на `public` получателя, 1: на `observed`.
- `kind` — 0: данные (payload = UDP-датаграмма WebRTC как есть), 1: keepalive
  (payload = 1 байт: маска `path`, по которым отправитель получает пакеты).

## 4. ICE-кандидат туннеля (добавляется локально, не через сигналинг)

```
candidate:p2ptun 1 udp <prio> <lanIp> <proxyPort> typ host generation 0
sdpMid = mid первой m-строки, sdpMLineIndex = 0
```

`<prio>` = `(0 << 24) | (65535 << 8) | 255` — уровень relay-кандидата, ниже любого srflx.
Добавляется после первого `setRemoteDescription` и после каждого ICE restart.
