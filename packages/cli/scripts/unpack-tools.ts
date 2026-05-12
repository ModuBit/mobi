/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * 开发模式下解压平台特定的工具二进制文件（ripgrep、difftastic）
 * 编译模式下由 ensureRuntimeAssets() 自动处理
 *
 * 用法: bun run scripts/unpack-tools.ts
 */

import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { arch, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';

const __dirname = dirname(fileURLToPath(import.meta.url));
const toolsDir = resolve(__dirname, '..', 'tools');
const UNPACKED_PLATFORM_MARKER = 'unpacked-platform';

function getPlatformDir(): string {
    const platformName = platform();
    const archName = arch();

    if (platformName === 'darwin') {
        if (archName === 'arm64') return 'arm64-darwin';
        if (archName === 'x64') return 'x64-darwin';
    } else if (platformName === 'linux') {
        if (archName === 'arm64') return 'arm64-linux';
        if (archName === 'x64') return 'x64-linux';
    } else if (platformName === 'win32') {
        if (archName === 'x64') return 'x64-win32';
    }

    throw new Error(`Unsupported platform: ${archName}-${platformName}`);
}

function areToolsUnpacked(): boolean {
    const unpackedPath = join(toolsDir, 'unpacked');
    if (!existsSync(unpackedPath)) {
        return false;
    }

    const isWin = platform() === 'win32';
    const difftBinary = isWin ? 'difft.exe' : 'difft';
    const rgBinary = isWin ? 'rg.exe' : 'rg';

    return [
        join(unpackedPath, difftBinary),
        join(unpackedPath, rgBinary),
    ].every(file => existsSync(file));
}

function unpackTools(): void {
    if (areToolsUnpacked()) {
        console.log('Tools already unpacked for', getPlatformDir());
        return;
    }

    const platformDir = getPlatformDir();
    const archivesDir = join(toolsDir, 'archives');
    const unpackedPath = join(toolsDir, 'unpacked');

    console.log(`Unpacking tools for ${platformDir}...`);

    if (!existsSync(archivesDir)) {
        console.warn(`Archives directory not found: ${archivesDir}, skipping tools unpack`);
        return;
    }

    mkdirSync(unpackedPath, { recursive: true });

    const archives = [
        `difftastic-${platformDir}.tar.gz`,
        `ripgrep-${platformDir}.tar.gz`,
    ];

    for (const archiveName of archives) {
        const archivePath = join(archivesDir, archiveName);
        if (!existsSync(archivePath)) {
            console.warn(`Archive not found: ${archivePath}, skipping tools unpack`);
            return;
        }
        tar.extract({ file: archivePath, cwd: unpackedPath, sync: true, preserveOwner: false });
    }

    if (platform() !== 'win32') {
        const files = readdirSync(unpackedPath);
        for (const file of files) {
            if (file.endsWith('.node')) continue;
            const filePath = join(unpackedPath, file);
            const stats = statSync(filePath);
            if (stats.isFile()) {
                chmodSync(filePath, 0o755);
            }
        }
    }

    // 写入平台标记文件，标识已解压的二进制匹配当前平台
    writeFileSync(join(unpackedPath, UNPACKED_PLATFORM_MARKER), `${platformDir}\n`, 'utf-8');

    console.log(`Tools unpacked successfully to ${unpackedPath}`);
}

unpackTools();
