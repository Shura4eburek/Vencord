/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { offerCollides } from "./session";

test("offer in stable state does not collide", () => {
    assert.equal(offerCollides(false, "stable", false), false);
});

test("offer while our answer is being applied does not collide", () => {
    // удалённый ответ ещё применяется: состояние have-local-offer, но мы уже готовы к новому offer
    assert.equal(offerCollides(false, "have-local-offer", true), false);
});

test("offer while we have our own pending offer collides", () => {
    assert.equal(offerCollides(false, "have-local-offer", false), true);
});

test("offer while we are making an offer collides", () => {
    assert.equal(offerCollides(true, "stable", false), true);
});
