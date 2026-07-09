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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    resolveClaudeTarget,
    buildTarballUrl,
    resolveRegistry,
    verifySha256,
} from '@/runtime/claudeBinarySource';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpRoot = join(tmpdir(), `mobi-test-sha-${process.pid}`);

describe('resolveClaudeTarget', () => {
    it('映射 darwin-arm64', () => {
        const t = resolveClaudeTarget('bun-darwin-arm64');
        expect(t.subpackage).toBe('@anthropic-ai/claude-agent-sdk-darwin-arm64');
        expect(t.manifestKey).toBe('darwin-arm64');
        expect(t.binaryName).toBe('claude');
        expect(t.archiveFile).toBe('claude-darwin-arm64.bin');
    });

    it('映射 win32-x64（二进制名带 .exe）', () => {
        const t = resolveClaudeTarget('bun-windows-x64');
        expect(t.subpackage).toBe('@anthropic-ai/claude-agent-sdk-win32-x64');
        expect(t.binaryName).toBe('claude.exe');
        expect(t.archiveFile).toBe('claude-win32-x64.bin');
    });

    it('映射 linux-x64-baseline 到 glibc linux-x64', () => {
        const t = resolveClaudeTarget('bun-linux-x64-baseline');
        expect(t.subpackage).toBe('@anthropic-ai/claude-agent-sdk-linux-x64');
        expect(t.manifestKey).toBe('linux-x64');
    });

    it('未知 target 抛错', () => {
        expect(() => resolveClaudeTarget('bun-solaris-x64')).toThrow(/unsupported/i);
    });
});

describe('resolveRegistry', () => {
    // 保存/恢复原始 env，避免污染其他用例与全局 process.env
    const orig = process.env.MOBI_NPM_REGISTRY;
    afterEach(() => {
        if (orig === undefined) delete process.env.MOBI_NPM_REGISTRY;
        else process.env.MOBI_NPM_REGISTRY = orig;
    });

    it('env 未设时回退默认官方源', () => {
        delete process.env.MOBI_NPM_REGISTRY;
        expect(resolveRegistry()).toBe('https://registry.npmjs.org');
    });

    it('env 为空字符串/纯空白时回退默认官方源', () => {
        process.env.MOBI_NPM_REGISTRY = '   ';
        expect(resolveRegistry()).toBe('https://registry.npmjs.org');
        process.env.MOBI_NPM_REGISTRY = '';
        expect(resolveRegistry()).toBe('https://registry.npmjs.org');
    });

    it('env 设为阿里镜像源时生效', () => {
        process.env.MOBI_NPM_REGISTRY = 'https://registry.npmmirror.com';
        expect(resolveRegistry()).toBe('https://registry.npmmirror.com');
    });

    it('env 带尾斜杠时被规范化去掉（避免拼出双斜杠）', () => {
        process.env.MOBI_NPM_REGISTRY = 'https://registry.npmmirror.com/';
        expect(resolveRegistry()).toBe('https://registry.npmmirror.com');
    });

    it('接受显式 env 参数（便于测试注入，不读全局 env）', () => {
        expect(resolveRegistry({ MOBI_NPM_REGISTRY: 'https://example.com' })).toBe('https://example.com');
        expect(resolveRegistry({})).toBe('https://registry.npmjs.org');
    });
});

describe('buildTarballUrl', () => {
    it('拼出标准 npm registry URL（默认官方源）', () => {
        const url = buildTarballUrl('@anthropic-ai/claude-agent-sdk-darwin-arm64', '0.3.204');
        expect(url).toBe('https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-darwin-arm64/-/claude-agent-sdk-darwin-arm64-0.3.204.tgz');
    });

    it('显式传 registryBase 时覆盖默认源', () => {
        const url = buildTarballUrl(
            '@anthropic-ai/claude-agent-sdk-darwin-arm64',
            '0.3.204',
            'https://registry.npmmirror.com',
        );
        expect(url).toBe('https://registry.npmmirror.com/@anthropic-ai/claude-agent-sdk-darwin-arm64/-/claude-agent-sdk-darwin-arm64-0.3.204.tgz');
    });
});

describe('verifySha256', () => {
    beforeEach(() => mkdirSync(tmpRoot, { recursive: true }));
    afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

    it('sha256 匹配返回 true', async () => {
        const f = join(tmpRoot, 'sha-test.bin');
        writeFileSync(f, 'hello');
        const sha = createHash('sha256').update('hello').digest('hex');
        await expect(verifySha256(f, sha)).resolves.toBe(true);
    });

    it('sha256 不匹配返回 false', async () => {
        const f = join(tmpRoot, 'sha-test.bin');
        writeFileSync(f, 'hello');
        await expect(verifySha256(f, 'deadbeef')).resolves.toBe(false);
    });
});
