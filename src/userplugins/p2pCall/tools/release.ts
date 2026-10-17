/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Публикация сборки P2PCall в релизы форка. Запуск из корня Vencord (собирает сам):
//   npx tsx src/userplugins/p2pCall/tools/release.ts "что изменилось"

import { execFileSync } from "child_process";
import { sign } from "crypto";
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";

import { nextVersion, RELEASE_REPO, sha256Hex, UPDATE_FILES, UPDATE_FILES_V2, VERSION_FILE } from "../updateLogic";

const ROOT = process.cwd();
const DIST = join(ROOT, "dist");
const PACKAGE_TEMPLATE = join(ROOT, "src", "userplugins", "p2pCall", "tools", "package");
const notes = process.argv[2] ?? "Обновление P2PCall";

function lastVersion(): string | null {
    try {
        const tag = execFileSync("gh", ["release", "view", "--repo", RELEASE_REPO, "--json", "tagName", "-q", ".tagName"], { encoding: "utf8" }).trim();
        return tag.replace(/^p2p-/, "") || null;
    } catch {
        return null;
    }
}

// Детерминированная сборка: без меток времени и коммита неизменённый файл совпадает байт в байт,
// и автообновление по sha256 понимает, что реально поменялось (specs/002-update-apply-modes R1).
// Падение сборки останавливает релиз — старый dist больше не уедет под новой версией.
const root = ROOT.split("\\").join("/");
execFileSync("pnpm", ["build"], {
    stdio: "inherit",
    shell: true,
    env: {
        ...process.env,
        SOURCE_DATE_EPOCH: "1700000000",
        VENCORD_HASH: "p2pcall",
        GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: root,
    },
});

const version = nextVersion(new Date(), lastVersion());
const work = join(tmpdir(), `p2pcall-release-${version}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// версия в dist — её прочитает автообновление у установленных копий
writeFileSync(join(DIST, VERSION_FILE), version);

const files: Record<string, string> = {};
for (const name of UPDATE_FILES_V2) {
    const src = join(DIST, name);
    files[name] = sha256Hex(readFileSync(src));
    copyFileSync(src, join(work, name));
}
// подпись ключом, которого нет на GitHub: автообновление без неё ничего не ставит
const key = readFileSync(join(homedir(), ".p2pcall", "release-key.pem"));
function writeManifest(name: string, body: object) {
    const bytes = Buffer.from(JSON.stringify(body, null, 2));
    writeFileSync(join(work, name + ".json"), bytes);
    writeFileSync(join(work, name + ".sig"), sign(null, bytes, key));
}
// manifest.json — для установок до manifest-v2: ровно 4 файла, иначе они отклонят релиз и застрянут
writeManifest("manifest", { version, files: Object.fromEntries(UPDATE_FILES.map(n => [n, files[n]])) });
writeManifest("manifest-v2", { schema: 2, version, files });

// установочный архив: шаблон + файлы сборки + установщик Vencord
const pkg = join(work, "P2PCall-Vencord");
cpSync(PACKAGE_TEMPLATE, pkg, { recursive: true, filter: src => !src.endsWith(".gitattributes") });
mkdirSync(join(pkg, "dist", "Installer"), { recursive: true });
for (const name of [...UPDATE_FILES_V2, VERSION_FILE]) copyFileSync(join(DIST, name), join(pkg, "dist", name));
copyFileSync(join(DIST, "Installer", "VencordInstallerCli.exe"), join(pkg, "dist", "Installer", "VencordInstallerCli.exe"));
const zip = join(work, "P2PCall-Vencord.zip");
execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${pkg}' -DestinationPath '${zip}' -Force`], { stdio: "inherit" });
copyFileSync(zip, join(homedir(), "Downloads", "P2PCall-Vencord.zip"));

execFileSync("gh", [
    "release", "create", `p2p-${version}`,
    "--repo", RELEASE_REPO,
    "--title", `P2PCall ${version}`,
    "--notes", notes,
    ...UPDATE_FILES_V2.map(n => join(work, n)),
    ...["manifest.json", "manifest.sig", "manifest-v2.json", "manifest-v2.sig"].map(n => join(work, n)),
    zip,
], { stdio: "inherit" });

console.log(`Опубликовано: P2PCall ${version}`);
