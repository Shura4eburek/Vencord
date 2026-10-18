/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

import { calculateGenerator, finish, generatorString, scalarMultVfy, start, transcriptIr } from "./cpace";

// draft-irtf-cfrg-cpace-15, приложение B.3 (ristretto255, SHA-512)
const hex = (s: string) => hexToBytes(s.replace(/\s+/g, ""));
const PRS = utf8ToBytes("Password");
const CI = hex("6f630b425f726573706f6e6465720b415f696e69746961746f72");
const SID = hex("7e4b4791d6a8ef019b936c79fb7f2c57");
const ADa = utf8ToBytes("ADa"), ADb = utf8ToBytes("ADb");
const ya = hex("da3d23700a9e5699258aef94dc060dfda5ebb61f02a5ea77fad53f4ff0976d08");
const yb = hex("d2316b454718c35362d83d69df6320f38578ed5984651435e2949762d900b80d");

test("B.3.1 generator string and generator", () => {
    assert.equal(bytesToHex(generatorString(PRS, CI, SID)),
        "11435061636552697374726574746f3235350850617373776f726464" + "00".repeat(100) +
        "1a6f630b425f726573706f6e6465720b415f696e69746961746f72107e4b4791d6a8ef019b936c79fb7f2c57");
    assert.equal(bytesToHex(calculateGenerator(PRS, CI, SID).toBytes()), "a6fc82c3b8968fbb2e06fee81ca858586dea50d248f0c7ca6a18b0902a30b36b");
});

test("B.3.2–B.3.5 messages, secret point and initiator/responder ISK", () => {
    const A = start(PRS, CI, SID, ya), B = start(PRS, CI, SID, yb);
    assert.equal(bytesToHex(A.Y), "d40fb265a7abeaee7939d91a585fe59f7053f982c296ec413c624c669308f87a");
    assert.equal(bytesToHex(B.Y), "08bcf6e9777a9c313a3db6daa510f2d398403319c2341bd506a92e672eb7e307");
    assert.equal(bytesToHex(scalarMultVfy(A.y, B.Y)!), "e22b1ef7788f661478f3cddd4c600774fc0f41e6b711569190ff88fa0e607e09");
    const tr = transcriptIr(A.Y, ADa, B.Y, ADb);
    assert.equal(bytesToHex(tr), "20d40fb265a7abeaee7939d91a585fe59f7053f982c296ec413c624c669308f87a034144612008bcf6e9777a9c313a3db6daa510f2d398403319c2341bd506a92e672eb7e30703414462");
    const isk = "4c5469a16b2364c4b944ebc1a79e51d1674ad47db26e8718154f59faebfaa52d8346f30aa58377117eb20d527f2cbc5c76381f7fd372e89df8239f87f2e02ed1";
    assert.equal(bytesToHex(finish(A.y, B.Y, SID, tr)!), isk);
    assert.equal(bytesToHex(finish(B.y, A.Y, SID, tr)!), isk);
});

test("same password → same ISK with random scalars, different password → different ISK", () => {
    const A = start(PRS, CI, SID), B = start(PRS, CI, SID);
    const tr = transcriptIr(A.Y, ADa, B.Y, ADb);
    assert.equal(bytesToHex(finish(A.y, B.Y, SID, tr)!), bytesToHex(finish(B.y, A.Y, SID, tr)!));

    const E = start(utf8ToBytes("Passw0rd"), CI, SID);
    const tr2 = transcriptIr(A.Y, ADa, E.Y, ADb);
    assert.notEqual(bytesToHex(finish(A.y, E.Y, SID, tr2)!), bytesToHex(finish(E.y, A.Y, SID, tr2)!));
});

test("identity element and invalid encodings are rejected", () => {
    const A = start(PRS, CI, SID);
    assert.equal(scalarMultVfy(A.y, new Uint8Array(32)), null, "identity");
    assert.equal(scalarMultVfy(A.y, new Uint8Array(32).fill(0xff)), null, "not a ristretto encoding");
    assert.equal(finish(A.y, new Uint8Array(31), SID, new Uint8Array(0)), null, "wrong length");
});
