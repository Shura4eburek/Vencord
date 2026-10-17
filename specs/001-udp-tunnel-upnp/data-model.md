# Data Model: UDP-туннель

## TunnelInfo (своя сторона → собеседнику, сообщение `tun`)

| Поле | Тип | Правила |
|---|---|---|
| `addr` | `string` `ip:port` | публичный адрес туннельного сокета по STUN; `null`, если STUN не ответил |
| `token` | `string` hex(8 байт) | случайный на звонок; только внутри зашифрованного сигналинга |
| `upnp` | `"ok" \| "no-igd" \| "error"` | итог автопроброса этой стороны |

## PortMapping (main, UPnP)

| Поле | Тип | Правила |
|---|---|---|
| `port` | `number` | 40000–40999, внешний = внутренний |
| `lanIp` | `string` | локальный адрес маршрута по умолчанию |
| `controlUrl`, `service` | `string` | из описания IGD |
| `lease` | `600 \| 0` | 0 — если роутер требует постоянные (код 725) |

Состояния: `none → adding → active → (renewing → active)* → removing → none`. Ошибка `adding` →
`none` с причиной. `active` при `stop()`/`before-quit` → `removing`.

## TunnelPeer (main)

| Поле | Тип | Правила |
|---|---|---|
| `public` | `ip:port` | из `tun` собеседника |
| `observed` | `ip:port \| null` | источник последнего валидного пакета, если ≠ `public` |
| `token` | 8 байт | пакеты с другим токеном отбрасываются |
| `confirmedPaths` | битовая маска | из keepalive собеседника; пусто → данные на оба адреса |
| `lastRx` | `ms` | > 10 с тишины → статус `silent` |

## ProxySource (main)

| Поле | Тип | Правила |
|---|---|---|
| `addr` | `ip:port` | локальный сокет WebRTC, писавший в прокси |
| `lastSeen` | `ms` | забывается через 30 с |
| `media` | `boolean` | последний источник не-STUN пакета |

## TunnelStatus (main → рендерер, для лога и подсказки)

`{ port, lanIp, proxyPort, upnp, publicAddr, peer: { public, observed, confirmedPaths, rxAgoMs } | null, rx, tx, dropped }`

## PathType (рендерер, `stats.ts`)

`"host" | "srflx" | "relay" | "tunnel" | "unknown"`; `tunnel` — когда адрес удалённого кандидата
выбранной пары равен `lanIp:proxyPort`.
