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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    resolveForkActivation,
    verifyForkAnchorExists,
    omitForkFrom,
    withForkError,
    forkActivationFailureMessage,
    type ForkActivationPlan,
} from '../../../src/claude/utils/forkActivation'
import type { Metadata } from '@mobi/node-core/api/types'
import { buildForkStartupFields, resolveStartSessionId } from '../../../src/claude/claudeRemote'

vi.mock('../../../src/claude/utils/claudeCheckSession', () => ({
    claudeCheckSession: vi.fn(),
}))

import { claudeCheckSession } from '../../../src/claude/utils/claudeCheckSession'

const mockedCheckSession = vi.mocked(claudeCheckSession)

const plan: ForkActivationPlan = {
    parentNativeId: 'parent-native-1',
    anchorNativeId: 'anchor-uuid-1',
    forkNativeId: 'fork-native-1',
}

describe('resolveForkActivation', () => {
    it('forkFrom + nativeSessionId 齐全 → 激活计划（forkNativeId 取 metadata.nativeSessionId 预生成值）', () => {
        expect(resolveForkActivation({
            forkFrom: { parentSessionId: 'row-1', parentNativeId: 'parent-native-1', anchorNativeId: 'anchor-uuid-1' },
            nativeSessionId: 'fork-native-1',
        })).toEqual(plan)
    })

    it('无 forkFrom（普通会话）→ null', () => {
        expect(resolveForkActivation({ nativeSessionId: 'native-1' })).toBeNull()
    })

    it('metadata 为 null → null', () => {
        expect(resolveForkActivation(null)).toBeNull()
    })

    it('forkFrom 存在但 nativeSessionId 缺失（无法定位 fork 预生成 id）→ null', () => {
        expect(resolveForkActivation({
            forkFrom: { parentSessionId: 'row-1', parentNativeId: 'parent-native-1', anchorNativeId: 'anchor-uuid-1' },
        })).toBeNull()
    })
})

describe('buildForkStartupFields（spec §5.2 三值契约）', () => {
    it('forkSession 恒 true / resumeSessionAt 指锚点 / sessionId 指预生成 fork id', () => {
        expect(buildForkStartupFields(plan)).toEqual({
            forkSession: true,
            resumeSessionAt: 'anchor-uuid-1',
            sessionId: 'fork-native-1',
        })
    })
})

describe('resolveStartSessionId（fork 分支绕过 claudeCheckSession 守卫）', () => {
    beforeEach(() => {
        mockedCheckSession.mockReset()
    })

    it('fork 激活轮：startFrom 恒取 parentNativeId，不查守卫（预生成 fork id 无 transcript，守卫必误判）', () => {
        expect(resolveStartSessionId({
            forkActivation: plan,
            sessionId: 'fork-native-1',
            path: '/proj',
            claudeArgs: ['--resume', 'fork-native-1'],
        })).toBe('parent-native-1')
        expect(mockedCheckSession).not.toHaveBeenCalled()
    })

    it('非 fork 轮：sessionId transcript 有效 → 原样使用', () => {
        mockedCheckSession.mockReturnValue(true)
        expect(resolveStartSessionId({
            forkActivation: null,
            sessionId: 'native-1',
            path: '/proj',
        })).toBe('native-1')
        expect(mockedCheckSession).toHaveBeenCalledWith('native-1', '/proj')
    })

    it('非 fork 轮：sessionId 无 transcript → 回落 claudeArgs 的 --resume', () => {
        // 第一次调用：sessionId 守卫（无效）；第二次调用：claudeArgs --resume 校验（有效）
        mockedCheckSession.mockReturnValueOnce(false).mockReturnValueOnce(true)
        expect(resolveStartSessionId({
            forkActivation: null,
            sessionId: 'stale-native',
            path: '/proj',
            claudeArgs: ['--resume', 'args-native'],
        })).toBe('args-native')
    })
})

describe('verifyForkAnchorExists（激活前预检：活链存在性判定）', () => {
    beforeEach(() => {
        // 隔离 transcript 定位（不触真实 ~/.claude）
        process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'mobi-fork-'))
    })

    afterEach(() => {
        rmSync(process.env.CLAUDE_CONFIG_DIR!, { recursive: true, force: true })
        delete process.env.CLAUDE_CONFIG_DIR
    })

    it('锚点在活链上（真实 transcript fast path）→ ok', async () => {
        const dir = join(process.env.CLAUDE_CONFIG_DIR!, 'projects', '-dir')
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'parent-native-1.jsonl'), [
            JSON.stringify({ type: 'user', uuid: 'u1', message: { content: 'q' }, parentUuid: null }),
            JSON.stringify({ type: 'assistant', uuid: 'anchor-uuid-1', message: { content: [] }, parentUuid: 'u1' }),
        ].join('\n') + '\n')

        await expect(verifyForkAnchorExists('parent-native-1', '/dir', 'anchor-uuid-1')).resolves.toBe('ok')
    })

    it('锚点不在链上（parent 已 rewind 深于锚点）→ anchor-invalidated', async () => {
        const dir = join(process.env.CLAUDE_CONFIG_DIR!, 'projects', '-dir')
        mkdirSync(dir, { recursive: true })
        // rewind 后的 transcript：锚点行已被截断丢弃
        writeFileSync(join(dir, 'parent-native-1.jsonl'), [
            JSON.stringify({ type: 'user', uuid: 'u1', message: { content: 'q' }, parentUuid: null }),
            JSON.stringify({ type: 'assistant', uuid: 'a1', message: { content: [] }, parentUuid: 'u1' }),
        ].join('\n') + '\n')

        await expect(verifyForkAnchorExists('parent-native-1', '/dir', 'anchor-uuid-1')).resolves.toBe('anchor-invalidated')
    })

    it('transcript 文件不存在（parent transcript 丢失）→ anchor-invalidated（无法确认存在按常态失败码）', async () => {
        await expect(verifyForkAnchorExists('parent-native-1', '/dir', 'anchor-uuid-1')).resolves.toBe('anchor-invalidated')
    })
})

describe('omitForkFrom（fork 完成上报：清除激活簿记与失败标记，保留溯源）', () => {
    it('移除 forkFrom 键，forkedFrom 与其余字段原样保留', () => {
        const metadata = {
            path: '/proj',
            host: 'h-1',
            nativeSessionId: 'fork-native-1',
            forkFrom: { parentSessionId: 'row-1', parentNativeId: 'parent-native-1', anchorNativeId: 'anchor-uuid-1' },
            forkedFrom: { sessionId: 'row-1' },
        }
        const result = omitForkFrom(metadata)
        expect('forkFrom' in result).toBe(false)
        expect(result.forkedFrom).toEqual({ sessionId: 'row-1' })
        expect(result.nativeSessionId).toBe('fork-native-1')
        expect(result.path).toBe('/proj')
    })

    it('同时清除 forkError（成功抹掉历史失败标记，错误态随之消失）', () => {
        const metadata = {
            path: '/proj',
            host: 'h-1',
            forkFrom: { parentSessionId: 'row-1', parentNativeId: 'parent-native-1', anchorNativeId: 'anchor-uuid-1' },
            forkError: { code: 'activation-failed', at: 123 },
            forkedFrom: { sessionId: 'row-1' },
        } as Metadata
        const result = omitForkFrom(metadata)
        expect('forkFrom' in result).toBe(false)
        expect('forkError' in result).toBe(false)
        expect(result.forkedFrom).toEqual({ sessionId: 'row-1' })
    })
})

describe('withForkError（fork 失败上报：保留 forkFrom，叠加失败标记）', () => {
    const base = {
        path: '/proj',
        host: 'h-1',
        forkFrom: { parentSessionId: 'row-1', parentNativeId: 'parent-native-1', anchorNativeId: 'anchor-uuid-1' },
    } as Metadata

    it('保留 forkFrom（badge 不解除/删除守卫依赖），叠加 code/at', () => {
        const before = Date.now()
        const result = withForkError(base, 'anchor-invalidated')
        expect(result.forkFrom).toEqual(base.forkFrom)
        expect(result.forkError?.code).toBe('anchor-invalidated')
        expect(result.forkError?.at).toBeGreaterThanOrEqual(before)
        expect(result.forkError?.detail).toBeUndefined()
    })

    it('可选 detail 透传', () => {
        const result = withForkError(base, 'activation-failed', 'process exited')
        expect(result.forkError).toMatchObject({ code: 'activation-failed', detail: 'process exited' })
    })
})

describe('forkActivationFailureMessage（错误态文案，reason 区分；英文惯例见函数注释）', () => {
    it('anchor_gone：明确「父会话已回退过分叉锚点」（spec §5.3 语义）', () => {
        const text = forkActivationFailureMessage('anchor_gone')
        expect(text).toContain('rewound past the fork anchor')
    })

    it('resume_failed：携带失败细节，与 anchor_gone 文案可区分', () => {
        const text = forkActivationFailureMessage('resume_failed', 'process exited with code 1')
        expect(text).toContain('process exited with code 1')
        expect(text).not.toBe(forkActivationFailureMessage('anchor_gone'))
    })
})
