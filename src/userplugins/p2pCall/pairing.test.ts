/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { bytesToHex } from "@noble/hashes/utils";

import { ContactBook, newIdentity, pairKey, verificationCode } from "./contacts";
import { Pairing, PakeMsg, PeerInfo } from "./pairing";

const A = "600000000000000001", B = "500000000000000002", CH = "700000000000000003";

function party(selfId: string, clock: { t: number; }) {
    const id = newIdentity();
    const store = { data: null as string | null, load: () => store.data, save: (d: string) => { store.data = d; } };
    const book = new ContactBook(store, () => clock.t);
    return { selfId, id, book, p: new Pairing(selfId, id, book, () => clock.t) };
}

/** Гоняет сообщения между двумя сторонами, пока есть что слать; dm — какой ЛС каждая сторона видит с другой */
function run(first: PakeMsg, from: ReturnType<typeof party>, to: ReturnType<typeof party>, dmOf: (side: string) => PeerInfo | null) {
    let queue: { msg: PakeMsg; to: ReturnType<typeof party>; }[] = [{ msg: first, to }];
    const added: string[] = [];
    while (queue.length) {
        const next: typeof queue = [];
        for (const { msg, to: dst } of queue) {
            const r = dst.p.handle(JSON.parse(JSON.stringify(msg)), dmOf(dst.selfId));
            if (r.added) added.push(`${dst.selfId}:${r.added.result}`);
            for (const m of r.send) next.push({ msg: m, to: dst === to ? from : to });
        }
        queue = next;
    }
    return added;
}

test("two parties with the same DM end up with each other's keys, same pair key and code", () => {
    const clock = { t: 1_760_000_000_000 };
    const a = party(A, clock), b = party(B, clock);
    const added = run(a.p.start(B, { channelId: CH })!, a, b, () => ({ channelId: CH, name: "x" }));
    assert.deepEqual(added.sort(), [`${A}:trusted`, `${B}:trusted`].sort());
    assert.equal(b.book.get(A)!.devices[0].mutual, true, "responder knows the initiator has the key");
    assert.equal(a.book.get(B)!.devices[0].mutual, false, "initiator waits for pairok");

    const devOfB = a.book.get(B)!.devices[0], devOfA = b.book.get(A)!.devices[0];
    assert.equal(devOfB.publicKey, bytesToHex(b.id.publicKey));
    assert.equal(devOfA.publicKey, bytesToHex(a.id.publicKey));
    assert.equal(bytesToHex(pairKey(a.id, b.id.publicKey, b.id.deviceId)), bytesToHex(pairKey(b.id, a.id.publicKey, a.id.deviceId)));
    assert.equal(verificationCode(a.id.publicKey, b.id.publicKey), verificationCode(b.id.publicKey, a.id.publicKey));
});

test("a different channel id (wrong password) never produces a contact", () => {
    const clock = { t: 1_760_000_000_000 };
    const a = party(A, clock), b = party(B, clock);
    const added = run(a.p.start(B, { channelId: "700000000000000999" })!, a, b, side => ({ channelId: side === A ? "700000000000000999" : CH }));
    assert.deepEqual(added, []);
    assert.equal(a.book.get(B), null);
    assert.equal(b.book.get(A), null);
});

test("no DM with the sender → ignored", () => {
    const clock = { t: 1_760_000_000_000 };
    const a = party(A, clock), b = party(B, clock);
    assert.deepEqual(b.p.handle(a.p.start(B, { channelId: CH })!, null), { send: [], added: null });
});

test("stale or forged messages are ignored", () => {
    const clock = { t: 1_760_000_000_000 };
    const a = party(A, clock), b = party(B, clock);
    const m = a.p.start(B, { channelId: CH })!;
    assert.equal(b.p.handle({ ...m, ts: clock.t - 31_000 }, { channelId: CH }).send.length, 0, "too old");
    assert.equal(b.p.handle({ ...m, ts: undefined as any }, { channelId: CH }).send.length, 0, "no ts");
    assert.equal(b.p.handle({ ...m, Y: "00".repeat(32) } as PakeMsg, { channelId: CH }).send.length, 0, "identity point");
    assert.equal(b.p.handle({ ...m, from: B }, { channelId: CH }).send.length, 0, "from self");
});

test("a new key of a known contact is pending, the initiator does not restart with a trusted contact", () => {
    const clock = { t: 1_760_000_000_000 };
    const a = party(A, clock), b = party(B, clock);
    run(a.p.start(B, { channelId: CH })!, a, b, () => ({ channelId: CH }));
    // B переустановил плагин: новая личность, тот же пользователь
    const b2 = party(B, clock);
    clock.t += 11 * 60_000;
    const added = run(b2.p.start(A, { channelId: CH })!, b2, a, () => ({ channelId: CH }));
    assert.ok(added.includes(`${A}:pending`), added.join());
    assert.deepEqual(a.book.get(B)!.devices.map(d => d.state), ["trusted", "pending"]);
});

test("start is not repeated for the same peer within 10 minutes", () => {
    const clock = { t: 1_760_000_000_000 };
    const a = party(A, clock);
    assert.ok(a.p.start(B, { channelId: CH }));
    clock.t += 60_000;
    assert.equal(a.p.start(B, { channelId: CH }), null);
    clock.t += 10 * 60_000;
    assert.ok(a.p.start(B, { channelId: CH }));
    assert.equal(a.p.start(B, { channelId: CH }, true), null, "a call retries no sooner than 15 s");
    clock.t += 16_000;
    assert.ok(a.p.start(B, { channelId: CH }, true));
});

test("answers to pake1 are rate limited per sender and in total", () => {
    const clock = { t: 1_760_000_000_000 };
    const b = party(B, clock);
    const attempt = (from: string) => {
        const a = party(from, clock);
        return b.p.handle(a.p.start(B, { channelId: CH })!, { channelId: CH }).send.length;
    };
    const fromOne = Array.from({ length: 6 }, () => attempt(A));
    assert.deepEqual(fromOne, [1, 1, 1, 1, 1, 0], "6th per minute from one sender is ignored");
    const many = Array.from({ length: 30 }, (_, i) => attempt(String(800000000000000000n + BigInt(i))));
    assert.equal(many.filter(Boolean).length, 25, "30 in total per minute");
    clock.t += 95_000;
    assert.equal(attempt(A), 1, "window and the silent-guess pause pass");
});

test("forged pake2/pake3 do not kill a running exchange", () => {
    const clock = { t: 1_760_000_000_000 };
    const a = party(A, clock), b = party(B, clock);
    const m1 = a.p.start(B, { channelId: CH })!;
    const r2 = b.p.handle(m1, { channelId: CH });
    const real2 = r2.send[0];
    // наблюдатель шлёт мусор с теми же sid и from
    assert.equal(a.p.handle({ ...real2, box: "AAAA" } as PakeMsg, { channelId: CH }).added, null);
    assert.equal(b.p.handle({ type: "pake3", sid: m1.sid, from: A, ts: clock.t, box: "AAAA" }, { channelId: CH }).added, null);
    assert.equal(b.p.handle({ ...m1, Y: real2.type === "pake2" ? real2.Y : "" } as PakeMsg, { channelId: CH }).send.length, 0, "pake1 cannot overwrite the session");
    // настоящие сообщения всё ещё проходят
    const r3 = a.p.handle(real2, { channelId: CH });
    assert.equal(r3.added?.result, "trusted");
    assert.equal(b.p.handle(r3.send[0], { channelId: CH }).added?.result, "trusted");
});

test("a responder left without pake3 pauses that sender for a minute", () => {
    const clock = { t: 1_760_000_000_000 };
    const b = party(B, clock);
    const guess = () => party(A, clock).p.start(B, { channelId: CH })!;
    assert.equal(b.p.handle(guess(), { channelId: CH }).send.length, 1);
    clock.t += 31_000;
    assert.equal(b.p.handle(guess(), { channelId: CH }).send.length, 0, "paused after the silent guess");
    clock.t += 61_000;
    assert.equal(b.p.handle(guess(), { channelId: CH }).send.length, 1);
});

test("a low-order X25519 public key is refused", () => {
    const clock = { t: 1_760_000_000_000 };
    const a = party(A, clock), b = party(B, clock);
    (b.id as any).publicKey = new Uint8Array(32);
    const added = run(a.p.start(B, { channelId: CH })!, a, b, () => ({ channelId: CH }));
    assert.equal(a.book.get(B), null);
    assert.ok(!added.includes(`${A}:trusted`));
});

test("a non-mutual contact is re-paired, a mutual one is not", () => {
    const clock = { t: 1_760_000_000_000 };
    const a = party(A, clock), b = party(B, clock);
    run(a.p.start(B, { channelId: CH })!, a, b, () => ({ channelId: CH }));
    clock.t += 11 * 60_000;
    assert.ok(a.p.start(B, { channelId: CH }), "initiator does not know yet whether B got pake3");
    assert.equal(b.p.start(A, { channelId: CH }), null, "responder already has a mutual key");
});
