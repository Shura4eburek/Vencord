/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { classify, decode, header, HEADER_LEN, isPeerAddr, keepaliveBody, keepaliveMask, KIND_DATA, KIND_KEEPALIVE, TUNNEL_PRIORITY, tunnelCandidate } from "./tunnelWire";

const token = Buffer.from("0102030405060708", "hex");

test("header + payload round-trips through decode", () => {
    const pkt = Buffer.concat([header(token, 1, KIND_DATA), Buffer.from([0x80, 1, 2])]);
    const f = decode(pkt)!;
    assert.ok(f.token.equals(token));
    assert.equal(f.path, 1);
    assert.equal(f.kind, KIND_DATA);
    assert.deepEqual([...f.payload], [0x80, 1, 2]);
});

test("decode rejects short buffers, foreign magic and unknown path/kind", () => {
    assert.equal(decode(Buffer.alloc(HEADER_LEN - 1)), null);
    const bad = header(token, 0, KIND_DATA);
    bad.write("XXXX", 0, "latin1");
    assert.equal(decode(bad), null);
    const badPath = header(token, 0, KIND_DATA); badPath[12] = 2;
    assert.equal(decode(badPath), null);
    const badKind = header(token, 0, KIND_DATA); badKind[13] = 7;
    assert.equal(decode(badKind), null);
});

test("keepalive carries the receive mask", () => {
    const f = decode(Buffer.concat([header(token, 0, KIND_KEEPALIVE), keepaliveBody(0b10)]))!;
    assert.equal(f.kind, KIND_KEEPALIVE);
    assert.equal(keepaliveMask(f.payload), 0b10);
    assert.equal(keepaliveMask(Buffer.alloc(0)), 0);
});

test("classify follows RFC 7983", () => {
    assert.equal(classify(Uint8Array.of(0x00, 0x01)), "stun");
    assert.equal(classify(Uint8Array.of(22)), "dtls");
    assert.equal(classify(Uint8Array.of(0x90)), "rtp");
    assert.equal(classify(Uint8Array.of(70)), "other");
    assert.equal(classify(new Uint8Array(0)), "other");
});

test("tunnel candidate priority is below any WebRTC host/srflx candidate (RFC 8445)", () => {
    const prio = (type: number, local: number) => type * 2 ** 24 + local * 2 ** 8 + 255;
    assert.ok(TUNNEL_PRIORITY < prio(100, 0), "below srflx with the lowest local preference");
    assert.ok(TUNNEL_PRIORITY < prio(126, 0), "below host");
    const c = tunnelCandidate("192.168.1.102", 40123);
    assert.equal(c.candidate, `candidate:p2ptun 1 udp ${TUNNEL_PRIORITY} 192.168.1.102 40123 typ host generation 0`);
    assert.equal(c.sdpMLineIndex, 0);
});

test("peer tunnel address must be a public IPv4 that is not ours", () => {
    const own = new Set(["192.168.1.102", "26.197.58.138"]);
    assert.ok(isPeerAddr("178.158.220.104:40123", own));
    for (const bad of ["127.0.0.1:5000", "192.168.1.5:1", "10.0.0.1:1", "172.20.0.1:1", "169.254.1.1:1", "0.0.0.0:1", "239.255.255.250:1900", "26.197.58.138:1", "evil", "1.2.3.4"])
        assert.ok(!isPeerAddr(bad, own), bad);
});
