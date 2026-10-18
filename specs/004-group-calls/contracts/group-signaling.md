# Contract: групповой сигналинг

Транспорт, шифрование и топики — как в `003` (`signaling.ts`): сообщение `SignalMsg` шифруется ключом пары
связи; `callId` = `linkId`. Ниже — только новые поля и типы. Старые версии игнорируют незнакомые поля и
типы.

## Общие поля

```ts
caps?: string[]            // ring, accept: ["group"] у новой версии
group?: {
  id: string;              // groupId
  roster: RosterWire;      // полный состав, R6
}
RosterWire = { entries: { userId: string; joinedAt: number; by: string; }[]; tombs: { userId: string; leftAt: number; }[]; }
MemberKey = { userId: string; name: string; avatar: string | null; deviceId: string; publicKey: string; }
```

## Типы

| Тип | Кто → кому | Поля | Получатель |
|---|---|---|---|
| `ring` (+`group`, `caps`) | участник → приглашаемый | `group`, `keys: MemberKey[]` (все текущие участники) | окно входящего «групповой звонок: …»; на «Принять»/«Добавить сюда» — `contactIntroduce(keys)` |
| `ring` (+`auto: true`) = `link` | меньший ID → больший ID, оба в группе | `group` | принять без окна, если `group.id` — своя группа и отправитель в составе; иначе игнор. Повтор каждые 2 с до `accept`, ≤ 15 с |
| `accept` (+`caps`, `group`) | | | как сейчас + слить состав |
| `intro` | добавивший → каждый текущий участник | `groupId`, `key: MemberKey` (новый) | `contactIntroduce`, ответ не нужен |
| `roster` | любой → все по связям | `group` | `mergeRoster`; новые участники → `link` по R5 |
| `here` | каждый → все по связям, раз в 5 с | `groupId` | `lastHere = now` |
| `leave` | уходящий → все по связям | `groupId` | надгробие, связь закрыть, «X вышел» |
| `bye` | | | как сейчас — закрывает **связь**, не группу |

## Порядок при «Добавить сюда» (A в звонке с B, C звонит A)

1. C → A `ring` (у C нет группы — обычный звонок, `caps`).
2. A: «Добавить сюда» → A → C `accept` с `group` (состав A, B, C) и `keys` (B); A → B `intro` (ключ C),
   затем `roster`.
3. C и B кладут ключи друг друга в книгу (`via: A`), сливают состав.
4. Меньший из B/C шлёт `link` другому (R5), повторяя до `accept`.
5. Связь B–C: `accept` → offer/answer/ice/tun — как в звонке вдвоём.

Исходящий (A звонит C, будучи в звонке с B): A → C `ring` с `group` и `keys` (B); дальше с шага 2 после
`accept` от C.

## IPC (main, `native.ts`)

```ts
contactIntroduce(via: string, keys: MemberKey[]): { userId: string; result: "trusted" | "pending" | "known"; }[]
```

Свой ключ (`publicKey` = свой) пропускается. `pending` → уведомление о новом ключе (`003`), связь с этим
участником не устанавливается до подтверждения.
