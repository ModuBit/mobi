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

import { describe, it, expect } from 'vitest';
import { resolveClaudeTarget, buildTarballUrl, verifyChecksum } from '@/runtime/claudeBinarySource';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

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

describe('buildTarballUrl', () => {
    it('拼出标准 npm registry URL', () => {
        const url = buildTarballUrl('@anthropic-ai/claude-agent-sdk-darwin-arm64', '0.3.204');
        expect(url).toBe('https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-darwin-arm64/-/claude-agent-sdk-darwin-arm64-0.3.204.tgz');
    });
});

describe('verifyChecksum', () => {
    it('sha256 匹配返回 true', async () => {
        const f = '/tmp/_mobi_sha_test.bin';
        writeFileSync(f, 'hello');
        const sha = createHash('sha256').update('hello').digest('hex');
        await expect(verifyChecksum(f, sha)).resolves.toBe(true);
    });

    it('sha256 不匹配返回 false', async () => {
        const f = '/tmp/_mobi_sha_test.bin';
        writeFileSync(f, 'hello');
        await expect(verifyChecksum(f, 'deadbeef')).resolves.toBe(false);
    });
});
