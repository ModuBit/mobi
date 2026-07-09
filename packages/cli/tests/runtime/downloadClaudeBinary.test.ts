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
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 用真实 sha 注入 manifest mock，使缓存命中逻辑可离线验证
vi.mock('@/runtime/claudeBinarySource', async () => {
    const actual = await vi.importActual<typeof import('@/runtime/claudeBinarySource')>('@/runtime/claudeBinarySource');
    return {
        ...actual,
        readSdkVersion: () => '0.3.204',
        readSdkManifest: () => ({
            version: '2.1.204',
            platforms: { 'darwin-arm64': { binary: 'claude', checksum: 'WILL_BE_REPLACED', size: 3 } },
        }),
    };
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
        vi.spyOn(source, 'readSdkManifest').mockReturnValue({
            version: '2.1.204',
            platforms: { 'darwin-arm64': { binary: 'claude', checksum: 'a'.repeat(64), size: 3 } },
        });
        writeFileSync(join(tmpRoot, 'claude-darwin-arm64.bin'), 'stale');

        const { downloadClaudeBinary } = await import('../../../scripts/downloadClaudeBinary');
        // fetch 返回不合法内容 → 解压/校验失败 → throw
        fetchSpy.mockResolvedValue(new Response('not a tarball', { status: 200 }));
        await expect(downloadClaudeBinary('bun-darwin-arm64', {
            archivesDir: tmpRoot,
            fetchImpl: fetchSpy,
        })).rejects.toThrow();
        expect(fetchSpy).toHaveBeenCalled();
    });
});
