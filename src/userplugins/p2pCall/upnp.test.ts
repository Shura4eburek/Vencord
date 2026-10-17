/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import dgram from "node:dgram";
import http from "node:http";
import { test } from "node:test";

import { addPortMapping, discoverIgd, HttpInit, httpRequest, HttpResponse, Igd, parseIgd, parseSsdpLocation, PortMapping, soapErrorCode, UpnpDeps } from "./upnp";

const LOC = "http://192.168.50.1:5431/rootDesc.xml";
const IGD_XML = `<?xml version="1.0"?><root><device><deviceList><device><serviceList>
<service><serviceType>urn:schemas-upnp-org:service:Layer3Forwarding:1</serviceType><controlURL>/ctl/L3F</controlURL></service>
<service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType>
<controlURL>/ctl/IPConn</controlURL></service></serviceList></device></deviceList></device></root>`;
const IGD: Igd = { controlUrl: "http://192.168.50.1:5431/ctl/IPConn", service: "urn:schemas-upnp-org:service:WANIPConnection:1" };
const fault = (code: number): HttpResponse => ({ status: 500, body: `<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>${code}</errorCode></UPnPError></detail></s:Fault></s:Body></s:Envelope>` });

function fakeHttp(handler: (url: string, init: HttpInit) => HttpResponse) {
    const calls: { url: string; init: HttpInit; }[] = [];
    const d: UpnpDeps = {
        createSocket: () => dgram.createSocket("udp4"),
        request: async (url, init) => { calls.push({ url, init }); return handler(url, init); },
    };
    return { d, calls };
}

test("parseSsdpLocation is case-insensitive", () => {
    assert.equal(parseSsdpLocation(`HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=120\r\nLocation: ${LOC}\r\n\r\n`), LOC);
    assert.equal(parseSsdpLocation("HTTP/1.1 200 OK\r\n\r\n"), null);
});

test("parseIgd picks the WAN connection service and resolves a relative controlURL", () => {
    assert.deepEqual(parseIgd(IGD_XML, LOC), IGD);
    const ppp = IGD_XML.replace("WANIPConnection:1", "WANPPPConnection:1");
    assert.equal(parseIgd(ppp, LOC)!.service, "urn:schemas-upnp-org:service:WANPPPConnection:1");
    assert.equal(parseIgd(IGD_XML.replace("WANIPConnection:1", "Nothing:1"), LOC), null);
    const withBase = IGD_XML.replace("<device>", "<URLBase>http://10.0.0.1:80/</URLBase><device>");
    assert.equal(parseIgd(withBase, LOC)!.controlUrl, "http://10.0.0.1/ctl/IPConn");
});

test("AddPortMapping sends the full SOAP request", async () => {
    const { d, calls } = fakeHttp(() => ({ status: 200, body: "" }));
    assert.deepEqual(await addPortMapping(IGD, 40123, "192.168.50.143", d), { ok: true, lease: 600 });
    const { url, init } = calls[0];
    assert.equal(url, IGD.controlUrl);
    assert.equal(init.headers!.SOAPAction, `"${IGD.service}#AddPortMapping"`);
    for (const part of ["<NewExternalPort>40123</NewExternalPort>", "<NewInternalPort>40123</NewInternalPort>", "<NewProtocol>UDP</NewProtocol>",
        "<NewInternalClient>192.168.50.143</NewInternalClient>", "<NewLeaseDuration>600</NewLeaseDuration>", "<NewPortMappingDescription>P2PCall</NewPortMappingDescription>"])
        assert.ok(init.body!.includes(part), part);
});

test("725 OnlyPermanentLeasesSupported → retried with lease 0", async () => {
    const { d, calls } = fakeHttp((_, init) => init.body!.includes("<NewLeaseDuration>600<") ? fault(725) : { status: 200, body: "" });
    assert.deepEqual(await addPortMapping(IGD, 40123, "192.168.50.143", d), { ok: true, lease: 0 });
    assert.equal(calls.length, 2);
});

test("any refusal except a port conflict is retried as a permanent mapping", async () => {
    const { d, calls } = fakeHttp((_, init) => init.body!.includes("<NewLeaseDuration>600<") ? fault(402) : { status: 200, body: "" });
    assert.deepEqual(await addPortMapping(IGD, 40123, "192.168.50.143", d), { ok: true, lease: 0 });
    assert.equal(calls.length, 2);
    const conflict = fakeHttp(() => fault(718));
    assert.deepEqual(await addPortMapping(IGD, 40123, "192.168.50.143", conflict.d), { ok: false, code: 718 });
    assert.equal(conflict.calls.length, 1);
});

test("PortMapping.create maps 718 to conflict, other faults to error, no IGD to no-igd", async () => {
    assert.deepEqual(await PortMapping.create(IGD, 1, "x", fakeHttp(() => fault(718)).d), { status: "conflict" });
    assert.deepEqual(await PortMapping.create(IGD, 1, "x", fakeHttp(() => fault(501)).d), { status: "error", code: 501 });
    assert.deepEqual(await PortMapping.create(IGD, 1, "x", fakeHttp(() => { throw new Error("down"); }).d), { status: "error", code: null });
    assert.deepEqual(await PortMapping.create(null, 1, "x", fakeHttp(() => ({ status: 200, body: "" })).d), { status: "no-igd" });
    assert.equal(soapErrorCode("<html/>"), null);
});

test("PortMapping.close sends DeletePortMapping", async () => {
    const { d, calls } = fakeHttp(() => ({ status: 200, body: "" }));
    const r = await PortMapping.create(IGD, 40123, "192.168.50.143", d);
    assert.equal(r.status, "ok");
    if (r.status === "ok") await r.mapping.close();
    assert.equal(calls[1].init.headers!.SOAPAction, `"${IGD.service}#DeletePortMapping"`);
    assert.ok(calls[1].init.body!.includes("<NewExternalPort>40123</NewExternalPort>"));
});

test("discoverIgd: answer from a fake router on loopback → IGD; silence → null", async () => {
    const router = dgram.createSocket("udp4");
    router.on("message", (m, r) => {
        if (m.toString().startsWith("M-SEARCH")) router.send(`HTTP/1.1 200 OK\r\nST: x\r\nLOCATION: ${LOC}\r\n\r\n`, r.port, r.address);
    });
    await new Promise<void>(r => router.bind(0, "127.0.0.1", () => r()));
    const { d } = fakeHttp(url => url === LOC ? { status: 200, body: IGD_XML } : { status: 404, body: "" });
    assert.deepEqual(await discoverIgd("127.0.0.1", d, 500, ["127.0.0.1", router.address().port]), IGD);
    router.close();

    const silent = dgram.createSocket("udp4");
    await new Promise<void>(r => silent.bind(0, "127.0.0.1", () => r()));
    assert.equal(await discoverIgd("127.0.0.1", d, 300, ["127.0.0.1", silent.address().port]), null);
    silent.close();
});

test("httpRequest sends the SOAP body with Content-Length, not chunked", async () => {
    let seen: http.IncomingHttpHeaders = {}, got = "";
    const srv = http.createServer((req, res) => {
        seen = req.headers;
        req.on("data", c => { got += c; });
        req.on("end", () => res.end("ok"));
    });
    await new Promise<void>(r => srv.listen(0, "127.0.0.1", () => r()));
    const body = "<s:Envelope>порт</s:Envelope>";
    const r = await httpRequest(`http://127.0.0.1:${(srv.address() as any).port}/ctl`, { method: "POST", body, timeoutMs: 2000 });
    srv.close();
    assert.equal(r.status, 200);
    assert.equal(seen["transfer-encoding"], undefined);
    assert.equal(seen["content-length"], String(Buffer.byteLength(body)));
    assert.equal(got, body);
});
