/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { bytesToHex } from "@noble/hashes/utils";

import { ContactBook, newIdentity, pairHintOf, pairKey, parseIdentity, serializeIdentity, Store, utcDay, verificationCode } from "./contacts";

function memory(): Store & { data: string | null; } {
    const s = { data: null as string | null, load: () => s.data, save: (d: string) => { s.data = d; } };
    return s;
}

const dev = (pub: string, id = "a".repeat(32)) => ({ deviceId: id, publicKey: pub, channelId: "700000000000000003", name: "Reva1v" });

test("first key of a contact is trusted, the next one waits for confirmation", () => {
    const b = new ContactBook(memory());
    assert.equal(b.addDevice("1", dev("k1")), "trusted");
    assert.equal(b.addDevice("1", dev("k1")), "known");
    assert.equal(b.addDevice("1", dev("k2", "b".repeat(32))), "pending");
    assert.deepEqual(b.get("1")!.devices.map(d => d.state), ["trusted", "pending"]);
    b.confirm("1", "k2");
    assert.equal(b.get("1")!.devices[1].state, "trusted");
});

test("mutual is set on add or later, never lost", () => {
    const b = new ContactBook(memory());
    b.addDevice("1", dev("k1"));
    assert.equal(b.get("1")!.devices[0].mutual, false);
    b.addDevice("1", { ...dev("k1"), mutual: true });
    assert.equal(b.get("1")!.devices[0].mutual, true);
    b.addDevice("2", { ...dev("k3"), mutual: true });
    assert.equal(b.get("2")!.devices[0].mutual, true);
});

test("verified flag, device and contact removal, persistence", () => {
    const store = memory();
    const b = new ContactBook(store);
    b.addDevice("1", dev("k1"));
    b.addDevice("1", dev("k2"));
    b.setVerified("1", "k1", true);
    b.updateProfile("1", "doomer", "https://cdn/a.png");

    const again = new ContactBook(store);
    assert.equal(again.get("1")!.devices[0].verified, true);
    assert.equal(again.get("1")!.name, "doomer");

    again.remove("1", "k2");
    assert.equal(again.get("1")!.devices.length, 1);
    again.remove("1");
    assert.equal(again.get("1"), null);
    assert.deepEqual(JSON.parse(store.data!), []);
});

test("a corrupt store starts empty instead of throwing", () => {
    const s = memory();
    s.data = "{not json";
    assert.deepEqual(new ContactBook(s).list(), []);
});

test("identity round-trips through serialization", () => {
    const id = newIdentity();
    const back = parseIdentity(serializeIdentity(id))!;
    assert.equal(back.deviceId, id.deviceId);
    assert.equal(bytesToHex(back.publicKey), bytesToHex(id.publicKey));
    assert.equal(parseIdentity("garbage"), null);
});

test("both sides derive the same pair key, hint and verification code", () => {
    const a = newIdentity(), b = newIdentity();
    const ka = pairKey(a, b.publicKey, b.deviceId), kb = pairKey(b, a.publicKey, a.deviceId);
    assert.equal(bytesToHex(ka), bytesToHex(kb));
    const day = utcDay(Date.UTC(2026, 9, 18));
    assert.equal(pairHintOf(ka, day), pairHintOf(kb, day));
    assert.notEqual(pairHintOf(ka, day), pairHintOf(ka, day + 1), "changes every day");
    assert.match(verificationCode(a.publicKey, b.publicKey), /^\d{4} \d{4}$/);
    assert.equal(verificationCode(a.publicKey, b.publicKey), verificationCode(b.publicKey, a.publicKey));
    const c = newIdentity();
    assert.notEqual(verificationCode(a.publicKey, c.publicKey), verificationCode(a.publicKey, b.publicKey));
});
