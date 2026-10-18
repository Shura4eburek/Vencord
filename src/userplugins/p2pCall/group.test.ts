/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Group, initiator, isAlone, isMember, join, leave, MAX_MEMBERS, members, mergeRoster, newGroup, parseRoster, routeRing, stale, STALE_MS, toWire } from "./group";

const A = "100", B = "200", C = "300", D = "400";
const ids = (g: Group) => members(g).map(m => m.userId);
const base = () => join(newGroup("g1", A, 1000), B, A, 1001)!;

test("join adds a member once, leave removes, rejoin after leave counts", () => {
    let g = base();
    assert.deepEqual(ids(g), [A, B]);
    assert.equal(join(g, B, A, 1500), g);
    g = leave(g, B, 2000);
    assert.equal(isMember(g, B), false);
    g = join(g, B, A, 3000)!;
    assert.equal(isMember(g, B), true);
});

test("leave wins over an entry with a later clock of the same join", () => {
    const g = leave(join(newGroup("g1", A, 1000), B, A, 5000)!, B, 4000);
    assert.equal(isMember(g, B), false);
});

test("at most MAX_MEMBERS", () => {
    let g: Group | null = newGroup("g1", A, 0);
    for (let i = 1; i < MAX_MEMBERS; i++) g = join(g!, String(100 + i * 10), A, i);
    assert.equal(members(g!).length, MAX_MEMBERS);
    assert.equal(join(g!, "999", A, 99), null);
});

test("mergeRoster is idempotent and commutative; concurrent adds converge", () => {
    const g = base();
    const x = join(g, C, A, 2000)!;
    const y = join(g, D, B, 2001)!;
    const xy = mergeRoster(x, toWire(y));
    const yx = mergeRoster(y, toWire(x));
    assert.deepEqual(toWire(xy), toWire(yx));
    assert.deepEqual(ids(xy), [A, B, C, D]);
    assert.deepEqual(toWire(mergeRoster(xy, toWire(xy))), toWire(xy));
});

test("concurrent leave and merge converge", () => {
    const g = join(base(), C, A, 2000)!;
    const x = leave(g, C, 3000);
    const y = join(g, D, B, 2500)!;
    assert.deepEqual(toWire(mergeRoster(x, toWire(y))), toWire(mergeRoster(y, toWire(x))));
    assert.deepEqual(ids(mergeRoster(x, toWire(y))), [A, B, D]);
});

test("initiator is the smaller Discord ID, numerically", () => {
    assert.equal(initiator("99", "100"), "99");
    assert.equal(initiator("100", "99"), "99");
});

test("isAlone when only self is left", () => {
    assert.equal(isAlone(base(), A), false);
    assert.equal(isAlone(leave(base(), B, 5000), A), true);
});

test("stale: silent member, unchecked member and self are handled", () => {
    const g = join(base(), C, A, 1002)!;
    const here = new Map([[B, 0], [A, 0]]);
    assert.deepEqual(stale(g, A, here, STALE_MS + 1), [B]);
    assert.deepEqual(stale(g, A, here, STALE_MS), []);
});

test("parseRoster rejects malformed input", () => {
    assert.equal(parseRoster(null), null);
    assert.equal(parseRoster({ entries: [{ userId: "x", joinedAt: 1, by: A }], tombs: [] }), null);
    assert.deepEqual(parseRoster(toWire(base())), toWire(base()));
});

test("routeRing: invite during a call, auto only for own group members, busy otherwise", () => {
    const g = base();
    const ctx = { inCall: true, ringing: false, group: g, from: C, auto: false };
    assert.equal(routeRing(ctx), "invite");
    assert.equal(routeRing({ ...ctx, inCall: false }), "primary");
    assert.equal(routeRing({ ...ctx, inCall: false, ringing: true }), "busy");
    assert.equal(routeRing({ ...ctx, auto: true, from: B, ringGroupId: "g1" }), "auto-accept");
    assert.equal(routeRing({ ...ctx, auto: true, from: C, ringGroupId: "g1" }), "busy");
    assert.equal(routeRing({ ...ctx, auto: true, from: B, ringGroupId: "other" }), "busy");
    assert.equal(routeRing({ ...ctx, inCall: false, auto: true, from: B, ringGroupId: "g1" }), "busy");
});
