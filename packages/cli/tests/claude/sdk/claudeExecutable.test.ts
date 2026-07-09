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

import { describe, it, expect, vi, afterEach } from 'vitest';

describe('getClaudeExecutablePath', () => {
    afterEach(() => {
        delete process.env.MOBI_CLAUDE_PATH;
        vi.resetModules();
        vi.restoreAllMocks();
    });

    it('MOBI_CLAUDE_PATH 优先返回', async () => {
        process.env.MOBI_CLAUDE_PATH = '/custom/claude';
        const { getClaudeExecutablePath } = await import('@/claude/sdk/claudeExecutable');
        expect(await getClaudeExecutablePath()).toBe('/custom/claude');
    });

    it('dev 模式（非编译态）返回 undefined，交 SDK 自动 resolve', async () => {
        vi.doMock('@/projectPath', () => ({
            isBunCompiled: () => false,
            projectPath: () => '/x',
            runtimePath: () => '/x',
        }));
        const { getClaudeExecutablePath } = await import('@/claude/sdk/claudeExecutable');
        expect(await getClaudeExecutablePath()).toBeUndefined();
    });

    it('编译态走 extractFromBunfs', async () => {
        vi.doMock('@/projectPath', () => ({
            isBunCompiled: () => true,
            projectPath: () => '/x',
            runtimePath: () => '/x',
        }));
        vi.doMock('@anthropic-ai/claude-agent-sdk/extract', () => ({
            extractFromBunfs: (p: string) => `/tmp/extracted/${p}`,
        }));
        vi.doMock('@/runtime/embeddedClaudeBinary.bun', () => ({
            loadEmbeddedClaudeBinary: async () => '/bunfs/claude.bin',
        }));
        const { getClaudeExecutablePath } = await import('@/claude/sdk/claudeExecutable');
        expect(await getClaudeExecutablePath()).toBe('/tmp/extracted//bunfs/claude.bin');
    });
});
