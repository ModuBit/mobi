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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tar from 'tar';

// 保留真实实现，测试内按需 spyOn 覆盖 manifest / version
vi.mock('@/runtime/claudeBinarySource', async () => {
    const actual = await vi.importActual<typeof import('@/runtime/claudeBinarySource')>('@/runtime/claudeBinarySource');
    return { ...actual };
});

describe('downloadClaudeBinary', () => {
    const tmpRoot = join(tmpdir(), `_mobi_dl_${process.pid}`);
    const fetchSpy = vi.fn();

    beforeEach(() => {
        mkdirSync(tmpRoot, { recursive: true });
        fetchSpy.mockReset();
    });
    afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

    it('缓存 sha256 匹配时跳过下载', async () => {
        const data = 'abc';
        const sha = createHash('sha256').update(data).digest('hex');
        const source = await import('@/runtime/claudeBinarySource');
        vi.spyOn(source, 'readSdkVersion').mockReturnValue('0.3.204');
        vi.spyOn(source, 'readSdkManifest').mockReturnValue({
            version: '2.1.204',
            platforms: { 'darwin-arm64': { binary: 'claude', checksum: sha, size: 3 } },
        });

        const archive = join(tmpRoot, 'claude-darwin-arm64.bin');
        writeFileSync(archive, data);

        const { downloadClaudeBinary } = await import('../../../scripts/downloadClaudeBinary');
        const result = await downloadClaudeBinary('bun-darwin-arm64', {
            archivesDir: tmpRoot,
            fetchImpl: fetchSpy,
        });
        expect(result).toBe(archive);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('缓存损坏（sha 不匹配）触发重新下载', async () => {
        const source = await import('@/runtime/claudeBinarySource');
        vi.spyOn(source, 'readSdkVersion').mockReturnValue('0.3.204');
        vi.spyOn(source, 'readSdkManifest').mockReturnValue({
            version: '2.1.204',
            platforms: { 'darwin-arm64': { binary: 'claude', checksum: 'a'.repeat(64), size: 3 } },
        });
        writeFileSync(join(tmpRoot, 'claude-darwin-arm64.bin'), 'stale');

        const { downloadClaudeBinary } = await import('../../../scripts/downloadClaudeBinary');
        // tar.extract 在 tmpTar 内容非合法 tarball 时同步抛错（此用例的稳定失败点），在 sha256 校验之前
        // 注意：用 mockImplementation 每次返回新 Response（body 只能消费一次，重试场景需新实例）
        fetchSpy.mockImplementation(() => Promise.resolve(new Response('not a tarball', { status: 200 })));
        await expect(downloadClaudeBinary('bun-darwin-arm64', {
            archivesDir: tmpRoot,
            fetchImpl: fetchSpy,
        })).rejects.toThrow();
        expect(fetchSpy).toHaveBeenCalled();
    });

    it('下载成功但 sha256 不匹配时 throw 且清理 tmp', async () => {
        // 构造合法 tarball（内含 package/claude，内容 'wrong'），让 fetch 返回它
        // manifest checksum 设为不匹配值 → 解压成功但 sha 校验失败 → throw + 清理 .tmp
        const srcDir = join(tmpRoot, '_wrong_src');
        mkdirSync(join(srcDir, 'package'), { recursive: true });
        writeFileSync(join(srcDir, 'package', 'claude'), 'wrong');
        const fixturePath = join(tmpRoot, 'wrong.tgz');
        await tar.create({ file: fixturePath, gzip: true, cwd: srcDir }, ['package/claude']);

        const source = await import('@/runtime/claudeBinarySource');
        vi.spyOn(source, 'readSdkVersion').mockReturnValue('0.3.204');
        vi.spyOn(source, 'readSdkManifest').mockReturnValue({
            version: '2.1.204',
            platforms: { 'darwin-arm64': { binary: 'claude', checksum: 'a'.repeat(64), size: 3 } },
        });

        fetchSpy.mockResolvedValue(new Response(readFileSync(fixturePath), {
            status: 200,
            headers: { 'Content-Type': 'application/octet-stream' },
        }));

        const { downloadClaudeBinary } = await import('../../../scripts/downloadClaudeBinary');
        const archivePath = join(tmpRoot, 'claude-darwin-arm64.bin');
        await expect(downloadClaudeBinary('bun-darwin-arm64', {
            archivesDir: tmpRoot,
            fetchImpl: fetchSpy,
        })).rejects.toThrow(/sha256/);

        // sha 校验失败后清理 tmpArchive（${archivePath}.tmp）
        expect(existsSync(`${archivePath}.tmp`)).toBe(false);
        expect(fetchSpy).toHaveBeenCalled();
    });

    it('stall 超时：read 永久挂起时在 stallTimeoutMs 内 reject 而非永久阻塞', async () => {
        const source = await import('@/runtime/claudeBinarySource');
        vi.spyOn(source, 'readSdkVersion').mockReturnValue('0.3.204');
        vi.spyOn(source, 'readSdkManifest').mockReturnValue({
            version: '2.1.204',
            platforms: { 'darwin-arm64': { binary: 'claude', checksum: 'a'.repeat(64), size: 3 } },
        });

        // 构造 stall body：用真实 ReadableStream，先吐一块数据后永久挂起；
        // 监听 abort signal，abort 时 error 掉 stream 让挂起的 read() 抛出（模拟真实 fetch 行为）
        const stallFetch = vi.fn((_url: string, init?: RequestInit) => {
            const signal = init?.signal as AbortSignal;
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new Uint8Array([1, 2, 3]));
                    signal.addEventListener('abort', () => {
                        const reason = signal.reason;
                        controller.error(reason instanceof Error ? reason : new Error('aborted'));
                    });
                    // 不再 enqueue 也不 close —— 模拟 IPv6 stall：第二次 read 永久挂起
                },
            });
            return Promise.resolve(new Response(stream, { status: 200 }));
        });

        const { downloadClaudeBinary } = await import('../../../scripts/downloadClaudeBinary');
        const start = Date.now();
        await expect(downloadClaudeBinary('bun-darwin-arm64', {
            archivesDir: tmpRoot,
            fetchImpl: stallFetch,
            stallTimeoutMs: 200,  // 200ms 无数据即判定 stall
            maxRetries: 0,        // 不重试，stall 一次直接抛最终错误
        })).rejects.toThrow(/stall|失败/);
        const elapsed = Date.now() - start;

        // 核心断言：在合理时间内 reject（而非永久挂起）。200ms stall + 少量开销，应 < 3000ms
        expect(elapsed).toBeLessThan(3000);
        expect(stallFetch).toHaveBeenCalledTimes(1);
    });

    it('网络失败重试：前两次抛网络错误、第三次成功 → 最终成功且 fetch 被调 3 次', async () => {
        // 构造合法 tarball（内含 package/claude，内容 'ok'），sha 匹配
        const data = 'ok';
        const sha = createHash('sha256').update(data).digest('hex');
        const srcDir = join(tmpRoot, '_ok_src');
        mkdirSync(join(srcDir, 'package'), { recursive: true });
        writeFileSync(join(srcDir, 'package', 'claude'), data);
        const fixturePath = join(tmpRoot, 'ok.tgz');
        await tar.create({ file: fixturePath, gzip: true, cwd: srcDir }, ['package/claude']);
        const fixture = readFileSync(fixturePath);

        const source = await import('@/runtime/claudeBinarySource');
        vi.spyOn(source, 'readSdkVersion').mockReturnValue('0.3.204');
        vi.spyOn(source, 'readSdkManifest').mockReturnValue({
            version: '2.1.204',
            platforms: { 'darwin-arm64': { binary: 'claude', checksum: sha, size: data.length } },
        });

        // 前两次抛网络错误，第三次返回合法 tarball
        let calls = 0;
        const retryFetch = vi.fn(() => {
            calls++;
            if (calls <= 2) {
                return Promise.reject(new Error(`网络错误 #${calls}（模拟 ECONNRESET）`));
            }
            return Promise.resolve(new Response(fixture, { status: 200 }));
        });

        const { downloadClaudeBinary } = await import('../../../scripts/downloadClaudeBinary');
        const result = await downloadClaudeBinary('bun-darwin-arm64', {
            archivesDir: tmpRoot,
            fetchImpl: retryFetch,
            maxRetries: 2,
            // 退避用极小值避免测试慢：重试循环里 sleep = attempt * BACKOFF_BASE_MS
            // BACKOFF_BASE_MS 是模块常量（1000ms），这里无法覆盖，2 次重试共 ~3s
        });

        expect(result).toBe(join(tmpRoot, 'claude-darwin-arm64.bin'));
        expect(retryFetch).toHaveBeenCalledTimes(3);
        // 下载的文件内容正确
        expect(readFileSync(result, 'utf8')).toBe(data);
    });
});
