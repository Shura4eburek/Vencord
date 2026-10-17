/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { NetLoader } from "./netLoader";

/** Настоящий CommonJS-модуль на диске: версия видна в status(), активный звонок задаётся через prepare/close */
function moduleSource(version: string) {
    return `exports.createNet = () => {
        let active = null;
        globalThis.__p2pDisposed ??= [];
        return {
            prepare: async id => { active = id; return null; },
            setPeer: async () => {},
            status: () => ({ version: ${JSON.stringify(version)} }),
            close: id => { if (active === id) active = null; },
            closeAll: () => { active = null; },
            activeCallId: () => active,
            dispose: () => { globalThis.__p2pDisposed.push(${JSON.stringify(version)}); active = null; },
        };
    };`;
}

let bump = 0;
function write(path: string, src: string) {
    writeFileSync(path, src);
    // mtime на Windows бывает грубым — сдвигаем явно, чтобы загрузчик увидел новую версию
    const t = new Date(Date.now() + ++bump * 2000);
    utimesSync(path, t, t);
}

const version = (l: NetLoader) => (l.current()?.status("x") as unknown as { version: string; } | null)?.version;

test("loads the module, reloads a new file between calls and disposes the old one", () => {
    const path = join(mkdtempSync(join(tmpdir(), "p2p-net-")), "p2pcall-net.js");
    write(path, moduleSource("A"));
    const l = new NetLoader(path, { userData: "x" });
    l.get();
    assert.equal(version(l), "A");

    write(path, moduleSource("B"));
    l.get();
    assert.equal(version(l), "B");
    assert.ok((globalThis as any).__p2pDisposed.includes("A"));
});

test("a call in progress keeps the old module until it ends", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "p2p-net-")), "p2pcall-net.js");
    write(path, moduleSource("A"));
    const l = new NetLoader(path, { userData: "x" });
    await l.get()!.prepare("call-1");

    write(path, moduleSource("B"));
    l.get();
    assert.equal(version(l), "A", "not swapped mid-call");

    l.current()!.close("call-1");
    l.get();
    assert.equal(version(l), "B");
});

test("a broken new file keeps the previous module and flags broken", () => {
    const path = join(mkdtempSync(join(tmpdir(), "p2p-net-")), "p2pcall-net.js");
    write(path, moduleSource("A"));
    const l = new NetLoader(path, { userData: "x" });
    l.get();
    write(path, "this is not javascript (");
    l.get();
    assert.equal(version(l), "A");
    assert.equal(l.broken, true);

    write(path, moduleSource("C"));
    l.get();
    assert.equal(version(l), "C");
    assert.equal(l.broken, false);
});

test("no swap while a Discord restart is pending", () => {
    const path = join(mkdtempSync(join(tmpdir(), "p2p-net-")), "p2pcall-net.js");
    write(path, moduleSource("A"));
    let restartPending = false;
    const l = new NetLoader(path, { userData: "x" }, undefined, () => !restartPending);
    l.get();
    restartPending = true;
    write(path, moduleSource("B"));
    l.get();
    assert.equal(version(l), "A");
});

test("no module file yet → null, not broken", () => {
    const l = new NetLoader(join(mkdtempSync(join(tmpdir(), "p2p-net-")), "p2pcall-net.js"), { userData: "x" });
    assert.equal(l.get(), null);
    assert.equal(l.broken, false);
});
