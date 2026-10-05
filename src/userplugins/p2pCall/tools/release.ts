/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Публикация сборки P2PCall в релизы форка. Запуск из корня Vencord после `pnpm build`:
//   npx tsx src/userplugins/p2pCall/tools/release.ts "что изменилось"

import { execFileSync } from "child_process";
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";

import { nextVersion, RELEASE_REPO, sha256Hex, UPDATE_FILES, VERSION_FILE } from "../updateLogic";

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

const version = nextVersion(new Date(), lastVersion());
const work = join(tmpdir(), `p2pcall-release-${version}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// версия в dist — её прочитает автообновление у установленных копий
writeFileSync(join(DIST, VERSION_FILE), version);

const files: Record<string, string> = {};
for (const name of UPDATE_FILES) {
    const src = join(DIST, name);
    files[name] = sha256Hex(readFileSync(src));
    copyFileSync(src, join(work, name));
}
writeFileSync(join(work, "manifest.json"), JSON.stringify({ version, files }, null, 2));

// установочный архив: шаблон + файлы сборки + установщик Vencord
const pkg = join(work, "P2PCall-Vencord");
cpSync(PACKAGE_TEMPLATE, pkg, { recursive: true });
mkdirSync(join(pkg, "dist", "Installer"), { recursive: true });
for (const name of [...UPDATE_FILES, VERSION_FILE]) copyFileSync(join(DIST, name), join(pkg, "dist", name));
copyFileSync(join(DIST, "Installer", "VencordInstallerCli.exe"), join(pkg, "dist", "Installer", "VencordInstallerCli.exe"));
const zip = join(work, "P2PCall-Vencord.zip");
execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${pkg}' -DestinationPath '${zip}' -Force`], { stdio: "inherit" });
copyFileSync(zip, join(homedir(), "Downloads", "P2PCall-Vencord.zip"));

execFileSync("gh", [
    "release", "create", `p2p-${version}`,
    "--repo", RELEASE_REPO,
    "--title", `P2PCall ${version}`,
    "--notes", notes,
    ...UPDATE_FILES.map(n => join(work, n)),
    join(work, "manifest.json"),
    zip,
], { stdio: "inherit" });

console.log(`Опубликовано: P2PCall ${version}`);
