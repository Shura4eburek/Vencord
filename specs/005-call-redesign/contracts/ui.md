# UI contract: патч области звонка и компоненты

## Патч `CALL_AREA_PATCH`

```
find:    '"Missing channel in Channel.renderCall"'
match:   /this\.renderCall\(\),(?=this\.renderEmbeddedActivityPanel\(\))/
replace: "$self.renderCallArea(this.props.channel,this.props.height,()=>this.renderCall()),"
```

- Вызов `this.renderCall()` переходит внутрь нашей функции. Discord больше не рисует свою область сам: это делает `CallSlot`.
- `renderCallArea(channel, height, renderNative)`:

  | канал | результат |
  |---|---|
  | не ЛС или нет контроллера | `renderNative()` |
  | ЛС с контроллером | `<ErrorBoundary fallback={renderNative()}><CallSlot …/></ErrorBoundary>` |

- `patches.test.ts`: на фрагменте бандла после замены `this.renderCall()` встречается ровно один раз, внутри стрелочной функции.

## CallSlot

Props: `{ c, channel, height, renderNative: () => ReactNode }`.

| Discord (`renderNative()` ≠ null) | P2P (`areaVisible`) | рендер |
|---|---|---|
| нет | нет | `null` |
| да | нет | `native` |
| нет | да | `<CallArea tabs={null}/>` |
| да | да, `pickTab` = p2p | `<CallArea tabs={<Tabs/>}/>` |
| да | да, `pickTab` = discord | `<div class="p2p-native-wrap"><Tabs float/>{native}</div>` |

## CallArea: разметка

Классы как в дизайн-системе:

```
.p2p-area(style height)
  .p2p-header
    .p2p-header-left: {tabs} .p2p-title(svg phone, span)
    .p2p-header-right: [Сетка/Фокус — только в группе]
  .p2p-stage
    .p2p-stats?                      — только при включённой статистике и соединении
    .p2p-grid[data-count] | .p2p-focus(.p2p-focus-main, .p2p-strip) | .p2p-state
  ControlBar                         — не рендерится в фазе ended
  .p2p-resize                        — скрыта в :fullscreen
```

## ControlBar

| место | кнопка | действие |
|---|---|---|
| слева | `add-user` | `openAddMenu` → `c.dial` |
| центр | группа `camera` + шеврон | `c.toggleCam()`; шеврон открывает `openDeviceMenu("videoinput")` |
| центр | `screen` / `screen-stop` (`.p2p-ctrl-on`) | `pickSource` или поповер качества |
| центр | группа `mic` + шеврон (`.p2p-ctrl-off`, когда микрофон выключен) | `c.toggleMic()`; шеврон открывает `openDeviceMenu("audio")` с чекбоксом «Выключить звук» |
| центр | `hangup` (`.p2p-ctrl-danger`) | `c.hangup()` |
| справа | `fullscreen` | `requestFullscreen` / `exitFullscreen` |

До фазы `connected` видна только «Отключиться», как сейчас.

## controller.setDevice(kind, id)

- Записывает `settings.store`.
- Если идёт звонок:

  | kind | что делает |
  |---|---|
  | `audioinput` | новый захват микрофона; `setTrackAll("mic")`; старый трек останавливается; состояние mute сохраняется |
  | `videoinput` | если камера включена — новый захват и `setTrackAll("cam")` |
  | `audiooutput` | `setSinkId` у всех аудио-элементов связей |
