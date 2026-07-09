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
    resolveRegistry,
    verifySha256,
} from '../src/runtime/claudeBinarySource';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ARCHIVES_DIR = resolve(__dirname, '..', 'tools', 'archives');

export interface DownloadOptions {
    /** 覆盖缓存目录（测试用）；默认 packages/cli/tools/archives */
    archivesDir?: string;
    /** 覆盖 fetch（测试用）；默认 globalThis.fetch */
    fetchImpl?: typeof fetch;
    /** 覆盖 registry 前缀（测试用）；默认 resolveRegistry()（读 MOBI_NPM_REGISTRY env） */
    registryBase?: string;
    /** 单次 read 无数据超时（毫秒），命中则 abort 当前 fetch 触发重试；默认 30000 */
    stallTimeoutMs?: number;
    /** 网络失败/stall 重试次数；总尝试 = maxRetries + 1；默认 2 */
    maxRetries?: number;
    /** 每下载多少字节打一行进度日志；默认 10MB */
    progressIntervalBytes?: number;
}

/** 默认 stall 超时：30s 无数据则判定为 IPv6 stall 等永久挂起场景 */
const DEFAULT_STALL_TIMEOUT_MS = 30_000;
/** 默认重试次数：网络失败/stall 最多重试 2 次（共 3 次尝试） */
const DEFAULT_MAX_RETRIES = 2;
/** 默认进度日志间隔：每 10MB 打一行 */
const DEFAULT_PROGRESS_INTERVAL_BYTES = 10 * 1024 * 1024;
/** 重试退避基数（毫秒）：第 n 次重试前 sleep n * BACKOFF_BASE_MS */
const BACKOFF_BASE_MS = 1000;

/**
 * SHA256 校验失败错误 —— 不可重试（下载内容本身已确定错误，重试也是错的）
 *
 * 用自定义子类而非消息正则匹配区分可/不可重试错误，避免网络错误消息
 * 恰好含 "sha256" 字样时误判。
 */
class Sha256MismatchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'Sha256MismatchError';
    }
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
    const registryBase = opts.registryBase ?? resolveRegistry();
    const stallTimeoutMs = opts.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
    const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    const progressIntervalBytes = opts.progressIntervalBytes ?? DEFAULT_PROGRESS_INTERVAL_BYTES;

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

    const url = buildTarballUrl(target.subpackage, version, registryBase);
    console.log(`[download-claude] 下载 ${url}`);

    const tmpArchive = `${archivePath}.tmp`;

    // 下载+解压包重试循环：网络失败 / stall / abort 都视为可重试错误
    // 每次失败前清理 tmpTar/package/ 残留，避免污染下次尝试
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
            const backoff = attempt * BACKOFF_BASE_MS;
            console.log(`[download-claude] 第 ${attempt + 1} 次尝试（${backoff}ms 后重试）...`);
            await new Promise((r) => setTimeout(r, backoff));
            // 清理上次失败留下的残留（幂等）
            rmSync(`${tmpArchive}.tar`, { force: true });
            rmSync(join(dirname(tmpArchive), 'package'), { recursive: true, force: true });
        }
        try {
            await downloadAndExtractBinary(url, target.binaryName, tmpArchive, fetchImpl, {
                stallTimeoutMs,
                progressIntervalBytes,
            });
            // 下载+解压成功，校验 sha256
            if (!(await verifySha256(tmpArchive, expected))) {
                // sha 不匹配不可重试（下载内容本身错了，重试也是错的）→ 立即清理并抛
                rmSync(tmpArchive, { force: true });
                throw new Sha256MismatchError(
                    `下载的 ${target.binaryName} sha256 校验失败（期望 ${expected}）`,
                );
            }
            // 成功落地
            renameSync(tmpArchive, archivePath);
            if (process.platform !== 'win32') {
                chmodSync(archivePath, 0o755);
            }
            console.log(`[download-claude] 就绪: ${archivePath}`);
            return archivePath;
        } catch (err) {
            // sha 校验失败不重试（内容已确定错误）
            if (err instanceof Sha256MismatchError) {
                throw err;
            }
            lastErr = err;
            const reason = err instanceof Error ? err.message : String(err);
            console.warn(`[download-claude] 第 ${attempt + 1} 次尝试失败：${reason}`);
            // 清理本次失败产生的 tmpArchive（解压成功但 sha 未校验的也会被这里清掉）
            rmSync(tmpArchive, { force: true });
        }
    }
    // 重试耗尽
    throw new Error(
        `下载 ${url} 失败（已重试 ${maxRetries} 次）：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
}

/**
 * 下载 npm tarball，从中解压出 package/<binaryName> 裸二进制，写入 outPath
 *
 * 内建 stall 超时保护：fetch 传 AbortController signal，起看门狗定时器，
 * 每次 read 收到数据就重置；stallTimeoutMs 内无数据则 abort 中断 fetch
 * （治 IPv6 stall 永久挂起）。同时累计字节按 progressIntervalBytes 打进度日志。
 *
 * @param url npm tarball URL
 * @param binaryName tarball 内二进制文件名（npm 标准前缀 package/）
 * @param outPath 裸二进制落地绝对路径
 * @param fetchImpl fetch 实现
 * @param opts stallTimeoutMs 单次 read 无数据超时；progressIntervalBytes 进度日志字节间隔
 * @throws 下载失败 / stall 超时（abort）/ 解压失败 / 缺少目标条目
 */
async function downloadAndExtractBinary(
    url: string,
    binaryName: string,
    outPath: string,
    fetchImpl: typeof fetch,
    opts: { stallTimeoutMs: number; progressIntervalBytes: number },
): Promise<void> {
    const controller = new AbortController();
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    // 看门狗：每次收到数据重置；stallTimeoutMs 内无数据则 abort
    const armWatchdog = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(
            () => controller.abort(new Error(`下载 stall（${opts.stallTimeoutMs}ms 无数据）：${url}`)),
            opts.stallTimeoutMs,
        );
    };

    // fetch 传 signal：stall/手动 abort 都会中断底层连接
    const resp = await fetchImpl(url, { signal: controller.signal });
    if (!resp.ok || !resp.body) {
        throw new Error(`下载失败 ${resp.status}: ${url}`);
    }

    // 先把 tarball 落盘，再 tar.extract 单条目解压，最后重命名裸二进制
    const tmpTar = `${outPath}.tar`;
    const ws = createWriteStream(tmpTar);
    const reader = resp.body.getReader();
    let received = 0;
    let lastProgressAt = 0;
    try {
        armWatchdog();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.length;
            if (received - lastProgressAt >= opts.progressIntervalBytes) {
                console.log(`[download-claude] 已下载 ${(received / 1048576).toFixed(1)} MB`);
                lastProgressAt = received;
            }
            ws.write(value);
            armWatchdog(); // 收到数据就重置看门狗
        }
        console.log(`[download-claude] 下载完成 ${(received / 1048576).toFixed(1)} MB，解压中...`);
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
        // 无条件清理：停看门狗、cancel reader（释放 fetch body）、destroy ws、删 tmpTar 与 package/ 残留
        // 成功路径下 tmpTar / package/ 已不存在，force:true 幂等
        if (stallTimer) clearTimeout(stallTimer);
        // 再次 abort 确保连接释放（已完成的 fetch abort 无副作用，幂等）
        controller.abort();
        reader.cancel().catch(() => {});
        ws.destroy();
        rmSync(tmpTar, { force: true });
        rmSync(join(dirname(outPath), 'package'), { recursive: true, force: true });
    }
}
