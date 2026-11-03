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

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { resolveClaudeConfigDir } from '@/claudeSdk/claudeConfigDir'
import { getClaudeProjectPath, resolveTranscriptPath } from '@/claudeSdk/transcriptPath'

const originalEnv = process.env

describe('getClaudeProjectPath', () => {
    beforeEach(() => {
        process.env = { ...originalEnv }
        process.env.CLAUDE_CONFIG_DIR = '/custom/claude'
    })

    afterEach(() => {
        process.env = originalEnv
    })

    it('把 cwd 的非字母数字替换为 -', () => {
        expect(getClaudeProjectPath('/Users/steve/projects/my-app')).toBe(
            join('/custom/claude', 'projects', '-Users-steve-projects-my-app'),
        )
    })

    it('斜杠、点、下划线都替换为 -', () => {
        expect(getClaudeProjectPath('/data/github/mobi__worktrees/app.test.js')).toBe(
            join('/custom/claude', 'projects', '-data-github-mobi--worktrees-app-test-js'),
        )
    })

    it('相对 cwd 先 resolve', () => {
        expect(getClaudeProjectPath('./my-project')).toBe(
            join('/custom/claude', 'projects', `${process.cwd().replace(/[^a-zA-Z0-9]/g, '-')}-my-project`),
        )
    })

    it('未设置 CLAUDE_CONFIG_DIR 时落到 ~/.claude', () => {
        delete process.env.CLAUDE_CONFIG_DIR
        expect(getClaudeProjectPath('/tmp/x')).toBe(join(resolveClaudeConfigDir(), 'projects', '-tmp-x'))
    })
})

describe('resolveTranscriptPath', () => {
    it('返回 <project>/<nativeId>.jsonl', () => {
        const result = resolveTranscriptPath('0b37ea81-aaaa-bbbb-cccc-dddddddddddd', '/tmp/proj')
        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.path.endsWith(join('-tmp-proj', '0b37ea81-aaaa-bbbb-cccc-dddddddddddd.jsonl'))).toBe(true)
        }
    })

    it('缺 native id → 结构化原因', () => {
        expect(resolveTranscriptPath(null, '/tmp/proj')).toEqual({
            ok: false,
            reason: 'missing-native-session-id',
        })
        expect(resolveTranscriptPath('', '/tmp/proj')).toEqual({
            ok: false,
            reason: 'missing-native-session-id',
        })
    })

    it('缺 cwd → 结构化原因', () => {
        expect(resolveTranscriptPath('abc', '')).toEqual({ ok: false, reason: 'missing-working-directory' })
        expect(resolveTranscriptPath('abc', null)).toEqual({ ok: false, reason: 'missing-working-directory' })
    })

    it('native id 含路径分隔或 .. → 拒绝（防穿越）', () => {
        expect(resolveTranscriptPath('../evil', '/tmp/proj')).toEqual({
            ok: false,
            reason: 'invalid-native-session-id',
        })
        expect(resolveTranscriptPath('a/b', '/tmp/proj')).toEqual({
            ok: false,
            reason: 'invalid-native-session-id',
        })
    })
})
