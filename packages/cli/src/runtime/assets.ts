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

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { arch, platform } from 'node:os';
import * as tar from 'tar';
import packageJson from '../../package.json';
import type { EmbeddedAsset } from '#embedded-assets';
import { isBunCompiled, runtimePath } from '@/projectPath';
import { MOBI_PLUGIN_MANIFEST, MOBI_PLUGIN_MANIFEST_REL_PATH, PLUGIN_ASSET_PREFIX } from '@/runtime/bundledPlugins';
import { UNPACKED_PLATFORM_MARKER } from '@/utils/resolveBinaryPath';

const RUNTIME_MARKER = '.runtime-version';

function ensureDirectory(path: string): void {
    mkdirSync(path, { recursive: true });
}

const bunRuntime = (globalThis as typeof globalThis & {
    Bun?: { file: (source: string | URL) => { arrayBuffer: () => Promise<ArrayBuffer> } };
}).Bun;

async function copyAssetFile(asset: EmbeddedAsset, targetPath: string): Promise<void> {
    ensureDirectory(dirname(targetPath));
    if (bunRuntime) {
        const data = await bunRuntime.file(asset.sourcePath).arrayBuffer();
        writeFileSync(targetPath, Buffer.from(data));
        return;
    }

    copyFileSync(asset.sourcePath, targetPath);
    try {
        const stats = statSync(asset.sourcePath);
        chmodSync(targetPath, stats.mode);
    } catch {
        // Best-effort; permission adjustments are not critical.
    }
}

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

function areToolsUnpacked(unpackedPath: string): boolean {
    if (!existsSync(unpackedPath)) {
        return false;
    }

    const isWin = platform() === 'win32';
    const difftBinary = isWin ? 'difft.exe' : 'difft';
    const rgBinary = isWin ? 'rg.exe' : 'rg';

    const expectedFiles = [
        join(unpackedPath, difftBinary),
        join(unpackedPath, rgBinary)
    ];

    return expectedFiles.every((file) => existsSync(file));
}

function unpackTools(runtimeRoot: string): void {
    const platformDir = getPlatformDir();
    const toolsDir = join(runtimeRoot, 'tools');
    const archivesDir = join(toolsDir, 'archives');
    const unpackedPath = join(toolsDir, 'unpacked');

    if (areToolsUnpacked(unpackedPath)) {
        return;
    }

    rmSync(unpackedPath, { recursive: true, force: true });
    ensureDirectory(unpackedPath);

    const archives = [
        `difftastic-${platformDir}.tar.gz`,
        `ripgrep-${platformDir}.tar.gz`
    ];

    for (const archiveName of archives) {
        const archivePath = join(archivesDir, archiveName);
        if (!existsSync(archivePath)) {
            throw new Error(`Archive not found: ${archivePath}`);
        }
        tar.extract({
            file: archivePath,
            cwd: unpackedPath,
            sync: true,
            preserveOwner: false
        });
    }

    if (platform() !== 'win32') {
        const files = readdirSync(unpackedPath);
        for (const file of files) {
            if (file.endsWith('.node')) {
                continue;
            }
            const filePath = join(unpackedPath, file);
            const stats = statSync(filePath);
            if (stats.isFile()) {
                chmodSync(filePath, 0o755);
            }
        }
    }
}

function runtimeAssetsReady(runtimeRoot: string): boolean {
    return areToolsUnpacked(join(runtimeRoot, 'tools', 'unpacked'))
        && arePluginsUnpacked(runtimeRoot);
}

/** 插件资源是否带 plugins/ 前缀（工具段归 unpackTools，插件段归 syncPluginAssets） */
function isPluginAsset(asset: EmbeddedAsset): boolean {
    return asset.relativePath.startsWith(PLUGIN_ASSET_PREFIX);
}

/**
 * 插件段解包完整性探针：锚定插件 manifest——syncPluginAssets 把它放在全部资源
 * 释放完之后写，存在即「上一轮全量释放完成」，与具体 skill 命名解耦（skill 改名/
 * 增删不再使探针失效而触发无谓全量重释放）。与 areToolsUnpacked 同款语义。
 */
function arePluginsUnpacked(runtimeRoot: string): boolean {
    return existsSync(join(runtimeRoot, MOBI_PLUGIN_MANIFEST_REL_PATH));
}

/**
 * 释放内置插件资源到 runtime root（embedded assets 中带 plugins/ 前缀的部分）。
 * 幂等：探针文件存在即跳过，不重写；缺失才按 relativePath 全量重释放。
 * 独立导出供测试直接驱动（vitest 非 compiled，走不进 ensureRuntimeAssets 的编译态入口）。
 */
export async function syncPluginAssets(runtimeRoot: string, embeddedAssets: EmbeddedAsset[]): Promise<void> {
    if (arePluginsUnpacked(runtimeRoot)) {
        return;
    }

    for (const asset of embeddedAssets.filter(isPluginAsset)) {
        await copyAssetFile(asset, join(runtimeRoot, asset.relativePath));
    }

    // 插件清单不走 embedded asset（.json 被 resolveJsonModule 解析为对象），从常量写盘
    const manifestTarget = join(runtimeRoot, MOBI_PLUGIN_MANIFEST_REL_PATH);
    mkdirSync(dirname(manifestTarget), { recursive: true });
    writeFileSync(manifestTarget, MOBI_PLUGIN_MANIFEST);
}

export async function ensureRuntimeAssets(): Promise<void> {
    if (!isBunCompiled()) {
        return;
    }

    const { loadEmbeddedAssets } = await import('#embedded-assets');
    const runtimeRoot = runtimePath();
    const markerPath = join(runtimeRoot, RUNTIME_MARKER);
    if (existsSync(markerPath)) {
        const markerVersion = readFileSync(markerPath, 'utf-8').trim();
        if (markerVersion === packageJson.version && runtimeAssetsReady(runtimeRoot)) {
            return;
        }
    }

    ensureDirectory(runtimeRoot);

    const embeddedAssets = await loadEmbeddedAssets();

    for (const asset of embeddedAssets) {
        // 插件段走 syncPluginAssets（自探针幂等），避免与工具段的无条件复制混流
        if (isPluginAsset(asset)) {
            continue;
        }
        const targetPath = join(runtimeRoot, asset.relativePath);
        await copyAssetFile(asset, targetPath);
    }

    unpackTools(runtimeRoot);
    await syncPluginAssets(runtimeRoot, embeddedAssets);
    writeFileSync(join(runtimeRoot, 'tools', 'unpacked', UNPACKED_PLATFORM_MARKER), getPlatformDir(), 'utf-8');
    writeFileSync(markerPath, packageJson.version, 'utf-8');
}
