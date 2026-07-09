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
 * build 时按 mobi build target 下载对应平台 claude 二进制
 *
 * 流程：从 npm 下载平台子包 tarball → 解压出裸二进制 → sha256 校验
 * → 落地到 packages/cli/tools/archives/<archiveFile>（已 gitignore）
 *
 * 缓存命中（sha256 匹配 manifest）则跳过下载。
 * 产物供 embeddedClaudeBinary.bun.ts 在 bun build --compile 时内嵌。
 */

import { chmodSync, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';
import {
    resolveClaudeTarget,
    buildTarballUrl,
    readSdkManifest,
    readSdkVersion,
    verifySha256,
} from '../src/runtime/claudeBinarySource';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ARCHIVES_DIR = resolve(__dirname, '..', 'tools', 'archives');

export interface DownloadOptions {
    /** 覆盖缓存目录（测试用）；默认 packages/cli/tools/archives */
    archivesDir?: string;
    /** 覆盖 fetch（测试用）；默认 globalThis.fetch */
    fetchImpl?: typeof fetch;
}

/**
 * 按 mobi build target 下载对应平台 claude 二进制到 <archivesDir>/<archiveFile>。
 * 缓存命中（sha256 匹配 manifest）则跳过下载。返回落地绝对路径。
 *
 * @param mobiTarget mobi build target（如 bun-darwin-arm64）
 * @param opts 可选覆盖（缓存目录、fetch 实现）
 * @throws manifest 缺 checksum / 下载失败 / sha256 校验失败
 */
export async function downloadClaudeBinary(
    mobiTarget: string,
    opts: DownloadOptions = {},
): Promise<string> {
    const archivesDir = opts.archivesDir ?? DEFAULT_ARCHIVES_DIR;
    const fetchImpl = opts.fetchImpl ?? fetch;

    const target = resolveClaudeTarget(mobiTarget);
    const version = readSdkVersion();
    const manifest = readSdkManifest();
    const expected = manifest.platforms[target.manifestKey]?.checksum;
    if (!expected) {
        throw new Error(`manifest 缺少 ${target.manifestKey} 的 checksum`);
    }

    mkdirSync(archivesDir, { recursive: true });
    const archivePath = join(archivesDir, target.archiveFile);

    // 缓存命中
    if (existsSync(archivePath)) {
        if (await verifySha256(archivePath, expected)) {
            console.log(`[download-claude] 缓存命中: ${archivePath}`);
            return archivePath;
        }
        console.warn(`[download-claude] 缓存损坏（sha256 不匹配），重新下载`);
        rmSync(archivePath, { force: true });
    }

    const url = buildTarballUrl(target.subpackage, version);
    console.log(`[download-claude] 下载 ${url}`);

    const tmpArchive = `${archivePath}.tmp`;
    await downloadAndExtractBinary(url, target.binaryName, tmpArchive, fetchImpl);

    // 校验下载结果
    if (!(await verifySha256(tmpArchive, expected))) {
        rmSync(tmpArchive, { force: true });
        throw new Error(`下载的 ${target.binaryName} sha256 校验失败（期望 ${expected}）`);
    }

    renameSync(tmpArchive, archivePath);
    if (process.platform !== 'win32') {
        chmodSync(archivePath, 0o755);
    }
    console.log(`[download-claude] 就绪: ${archivePath}`);
    return archivePath;
}

/**
 * 下载 npm tarball，从中解压出 package/<binaryName> 裸二进制，写入 outPath
 *
 * @param url npm tarball URL
 * @param binaryName tarball 内二进制文件名（npm 标准前缀 package/）
 * @param outPath 裸二进制落地绝对路径
 * @param fetchImpl fetch 实现
 * @throws 下载失败 / 解压失败 / 缺少目标条目
 */
async function downloadAndExtractBinary(
    url: string,
    binaryName: string,
    outPath: string,
    fetchImpl: typeof fetch,
): Promise<void> {
    const resp = await fetchImpl(url);
    if (!resp.ok || !resp.body) {
        throw new Error(`下载失败 ${resp.status}: ${url}`);
    }

    // 先把 tarball 落盘，再 tar.extract 单条目解压，最后重命名裸二进制
    const tmpTar = `${outPath}.tar`;
    const ws = createWriteStream(tmpTar);
    const reader = resp.body.getReader();
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            ws.write(value);
        }
        // ws.end() 而非 ws.close()：end 先 flush 缓冲再关 fd，close 只关 fd 不保证 flush
        await new Promise<void>((res, rej) => {
            ws.end((err: Error | null | undefined) => (err ? rej(err) : res()));
        });

        await tar.extract({
            file: tmpTar,
            cwd: dirname(outPath),
            preserveOwner: false,
        }, [`package/${binaryName}`]);

        const extracted = join(dirname(outPath), 'package', binaryName);
        if (!existsSync(extracted)) {
            throw new Error(`tarball 内未找到 package/${binaryName}（url=${url}）`);
        }
        renameSync(extracted, outPath);
    } finally {
        // 无条件清理：cancel reader（释放 fetch body）、destroy ws、删 tmpTar 与 package/ 残留
        // 成功路径下 tmpTar / package/ 已不存在，force:true 幂等
        reader.cancel().catch(() => {});
        ws.destroy();
        rmSync(tmpTar, { force: true });
        rmSync(join(dirname(outPath), 'package'), { recursive: true, force: true });
    }
}
