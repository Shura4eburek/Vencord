/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import dgram from "node:dgram";
import { after, test } from "node:test";

import { parseStunResponse, Tunnel, TunnelDeps } from "./tunnel";
import { decode, header, KIND_DATA } from "./tunnelWire";

const LO = "127.0.0.1";
const deps: TunnelDeps = { createSocket: () => dgram.createSocket("udp4"), isLocal: ip => ip === LO, stunServers: [] };
const tokA = Buffer.from("aaaaaaaaaaaaaaaa", "hex");
const tokB = Buffer.from("bbbbbbbbbbbbbbbb", "hex");
const open: { close(): void; }[] = [];
after(() => open.forEach(x => { try { x.close(); } catch { } }));

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
let nextPort = 41000 + Math.floor(Math.random() * 1500);

async function tunnel(token: Buffer) {
    for (; ;) {
        try {
            const t = await Tunnel.open({ port: nextPort++, proxyIp: LO, token, bindIp: LO, keepaliveMs: 50 }, deps);
            open.push(t);
            return t;
        } catch { }
    }
}

/** «WebRTC»: сокет на 127.0.0.1, который пишет в прокси туннеля и копит всё, что пришло */
async function webrtc(t: Tunnel) {
    const s = dgram.createSocket("udp4");
    open.push(s);
    const got: Buffer[] = [];
    s.on("message", m => got.push(m));
    await new Promise<void>(r => s.bind(0, LO, () => r()));
    return { got, send: (b: number[]) => s.send(Buffer.from(b), t.proxyPort, LO) };
}

/**
 * Несимметричный маршрут как у провайдера 05.10: пакеты B доходят до A с «внутреннего» адреса (relay),
 * а всё, что A шлёт на этот адрес, режется. В обратную сторону A → публичный адрес B работает.
 */
async function asymmetricPair() {
    const A = await tunnel(tokA), B = await tunnel(tokB);
    const relay = dgram.createSocket("udp4");
    open.push(relay);
    const droppedFromA: Buffer[] = [];
    relay.on("message", (m, r) => {
        if (r.port === B.status().port) relay.send(m, A.status().port, LO);
        else droppedFromA.push(m);
    });
    await new Promise<void>(r => relay.bind(0, LO, () => r()));
    A.setPeer(`${LO}:${B.status().port}`, tokB);
    B.setPeer(`${LO}:${relay.address().port}`, tokA);
    return { A, B, droppedFromA };
}

test("data flows both ways over an asymmetric route and the sender converges on the working path", async () => {
    const { A, B, droppedFromA } = await asymmetricPair();
    const wa = await webrtc(A), wb = await webrtc(B);
    wa.send([0, 1, 0, 0]); wb.send([0, 1, 0, 0]);
    await wait(300);

    assert.equal(A.status().peer!.observed !== null, true, "A saw B from the internal address");
    assert.equal(A.status().peer!.confirmedPaths, 0b01, "B only receives what A sends to its public address");

    const before = droppedFromA.filter(m => decode(m)?.kind === KIND_DATA).length;
    for (let i = 0; i < 10; i++) wa.send([0x80, i]);
    for (let i = 0; i < 10; i++) wb.send([0x80, 100 + i]);
    await wait(200);

    assert.equal(wb.got.filter(m => m[0] === 0x80).length, 10, "A → B delivered");
    assert.equal(wa.got.filter(m => m[0] === 0x80).length, 10, "B → A delivered");
    assert.equal(droppedFromA.filter(m => decode(m)?.kind === KIND_DATA).length, before, "no data wasted on the dead path");
});

test("packets with a foreign token are dropped", async () => {
    const A = await tunnel(tokA);
    A.setPeer(`${LO}:9`, tokB);
    const wa = await webrtc(A);
    wa.send([0, 1]);
    const evil = dgram.createSocket("udp4");
    open.push(evil);
    evil.send(Buffer.concat([header(Buffer.from("cccccccccccccccc", "hex"), 0, KIND_DATA), Buffer.from([0x80])]), A.status().port, LO);
    evil.send(Buffer.from("garbage"), A.status().port, LO);
    await wait(150);
    assert.equal(wa.got.length, 0);
    assert.equal(A.status().dropped, 2);
});

test("STUN goes to every WebRTC socket, media only to the one that sends media", async () => {
    const { A, B } = await asymmetricPair();
    const a1 = await webrtc(A), a2 = await webrtc(A), wb = await webrtc(B);
    a1.send([0, 1]); a2.send([0, 1]); wb.send([0, 1]);
    await wait(200);
    wb.send([1, 1, 7]);
    await wait(100);
    assert.ok(a1.got.some(m => m[2] === 7) && a2.got.some(m => m[2] === 7), "STUN to both");

    a2.send([0x80, 0]);
    await wait(100);
    wb.send([0x80, 42]);
    await wait(100);
    assert.ok(!a1.got.some(m => m[0] === 0x80), "a1 is not the media socket");
    assert.ok(a2.got.some(m => m[0] === 0x80 && m[1] === 42));
});

test("receive mask forgets a path that went quiet", async () => {
    let shift = 0;
    const clock: TunnelDeps = { ...deps, now: () => Date.now() + shift };
    const open2 = async (token: Buffer) => {
        for (; ;) {
            try {
                const t = await Tunnel.open({ port: nextPort++, proxyIp: LO, token, bindIp: LO, keepaliveMs: 50 }, clock);
                open.push(t);
                return t;
            } catch { }
        }
    };
    const A = await open2(tokA), B = await open2(tokB);
    A.setPeer(`${LO}:${B.status().port}`, tokB);
    B.setPeer(`${LO}:${A.status().port}`, tokA);
    await wait(200);
    assert.equal(A.status().peer!.rxPaths, 0b01);
    B.close();
    shift = 7000;
    assert.equal(A.status().peer!.rxPaths, 0);
});

test("close() frees the tunnel port", async () => {
    const A = await tunnel(tokA);
    const { port } = A.status();
    A.close();
    const again = await Tunnel.open({ port, proxyIp: LO, token: tokA, bindIp: LO }, deps);
    again.close();
});

test("parseStunResponse reads XOR-MAPPED-ADDRESS", () => {
    const tid = Buffer.alloc(12, 5);
    const msg = Buffer.alloc(32);
    msg.writeUInt16BE(0x0101, 0); msg.writeUInt16BE(12, 2); msg.writeUInt32BE(0x2112a442, 4); tid.copy(msg, 8);
    msg.writeUInt16BE(0x0020, 20); msg.writeUInt16BE(8, 22); msg[25] = 1;
    msg.writeUInt16BE(3409 ^ 0x2112, 26);
    [178, 158, 210, 54].forEach((b, k) => { msg[28 + k] = b ^ [0x21, 0x12, 0xa4, 0x42][k]; });
    assert.deepEqual(parseStunResponse(msg, tid), { address: "178.158.210.54", port: 3409 });
    assert.equal(parseStunResponse(msg, Buffer.alloc(12)), null);
});
