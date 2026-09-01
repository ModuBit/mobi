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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { query, startup } from '@anthropic-ai/claude-agent-sdk'
import {
    isRewindRefusalError,
    REWIND_REFUSAL_PREFIX,
    extractRewindRefusalFromResult,
} from '../../src/claude/utils/rewindRefusal'
import { claudeRemote } from '../../src/claude/claudeRemote'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
    query: vi.fn(),
    startup: vi.fn(),
}))
vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const mockedStartup = vi.mocked(startup)

/** 构造空流 Query（立即完成，无 init/result） */
function emptyQuery() {
    return {
        [Symbol.asyncIterator]() {
            return {
                async next(): Promise<IteratorResult<never>> {
                    return { done: true, value: undefined }
                },
            }
        },
        close: vi.fn(),
    }
}

/** claudeRemote 截断轮的最小 opts */
function truncationOpts() {
    return {
        sessionId: null as string | null,
        resumeSessionAt: 'anchor-assistant-1',
        resumeDropsTurn: 'user-msg-uuid',
        path: '/work/dir',
        allowedTools: [],
        hookSettingsPath: '/tmp/hook.json',
        getSessionConfig: () => ({ permissionMode: 'default' as const }),
        canCallTool: vi.fn(),
        nextMessage: vi.fn(() => new Promise<never>(() => { /* 永不 resolve */ })),
        onMessagesBound: vi.fn(),
        onReady: vi.fn(),
        onSessionFound: vi.fn(),
        onMessage: vi.fn(),
        onSnapshot: vi.fn(),
        getConverter: () => ({ convertSnapshot: vi.fn() }) as never,
        onRunningChange: vi.fn(),
        onQueryReady: vi.fn(),
    }
}

/**
 * isRewindRefusalError + extractRewindRefusalFromResult 单元覆盖（spec E1）：
 * SDK resume-drops-turn refusal 前缀判别，用于 startup catch（路径 A）
 * 与 result is_error 检测（路径 B）。
 */
describe('isRewindRefusalError', () => {
    const PREFIX = REWIND_REFUSAL_PREFIX

    it('匹配 refusal 前缀字符串', () => {
        expect(isRewindRefusalError(`${PREFIX} truncated range contains queued message`)).toBe(true)
    })
    it('Error 对象的 message 匹配前缀', () => {
        expect(isRewindRefusalError(new Error(`${PREFIX} something`))).toBe(true)
    })
    it('非 refusal error 不匹配', () => {
        expect(isRewindRefusalError('some other error')).toBe(false)
        expect(isRewindRefusalError(new Error('spawn failed'))).toBe(false)
    })
    it('undefined/null 不匹配', () => {
        expect(isRewindRefusalError(undefined)).toBe(false)
        expect(isRewindRefusalError(null)).toBe(false)
    })
})

describe('extractRewindRefusalFromResult（路径 B 检测）', () => {
    it('SDKResultError errors 数组含 refusal → 返回该文本', () => {
        const result = {
            is_error: true,
            errors: ['some other error', `${REWIND_REFUSAL_PREFIX} truncated range`],
        }
        expect(extractRewindRefusalFromResult(result)).toBe(`${REWIND_REFUSAL_PREFIX} truncated range`)
    })
    it('SDKResultSuccess result 字段含 refusal 前缀 → 返回该文本', () => {
        const result = {
            is_error: true,
            result: `${REWIND_REFUSAL_PREFIX} something went wrong`,
        }
        expect(extractRewindRefusalFromResult(result)).toBe(`${REWIND_REFUSAL_PREFIX} something went wrong`)
    })
    it('非 error result → null', () => {
        expect(extractRewindRefusalFromResult({ is_error: false, result: 'ok' })).toBeNull()
    })
    it('error 但无 refusal 前缀 → null', () => {
        expect(extractRewindRefusalFromResult({ is_error: true, errors: ['other error'] })).toBeNull()
    })
    it('无 is_error 字段 → null', () => {
        expect(extractRewindRefusalFromResult({})).toBeNull()
    })
})

/**
 * claudeRemote 截断轮 refusal recovery（路径 A：startup 抛错）。
 * 验证：startup 抛 refusal → 调 onRewindRefusal + return（不调 onRewindTruncated/nextMessage）。
 * 非 refusal 错误仍向上抛（由 launcher catch 补发 completed { error }）。
 */
describe('claudeRemote rewind refusal recovery（路径 A：startup 抛错）', () => {
    beforeEach(() => {
        mockedStartup.mockReset()
    })

    it('startup 抛 refusal → 调 onRewindRefusal + 不调 onRewindTruncated + 不调 nextMessage', async () => {
        const refusalMsg = `${REWIND_REFUSAL_PREFIX} truncated range contains queued message`
        mockedStartup.mockRejectedValue(new Error(refusalMsg))

        const onRewindRefusal = vi.fn()
        const onRewindTruncated = vi.fn().mockResolvedValue(undefined)
        const opts = {
            ...truncationOpts(),
            onRewindTruncated,
            onRewindRefusal,
        }

        await claudeRemote(opts)

        expect(onRewindRefusal).toHaveBeenCalledTimes(1)
        expect(onRewindRefusal).toHaveBeenCalledWith(refusalMsg)
        // onRewindTruncated 不应被调用（refusal 在截断前拦截）
        expect(onRewindTruncated).not.toHaveBeenCalled()
        // nextMessage 不应被调用（refusal 后直接 return）
        expect(opts.nextMessage).not.toHaveBeenCalled()
    })

    it('startup 抛非 refusal 错误 → 不调 onRewindRefusal，向上抛', async () => {
        mockedStartup.mockRejectedValue(new Error('spawn failed'))

        const onRewindRefusal = vi.fn()
        const onRewindTruncated = vi.fn().mockResolvedValue(undefined)
        const opts = {
            ...truncationOpts(),
            onRewindTruncated,
            onRewindRefusal,
        }

        await expect(claudeRemote(opts)).rejects.toThrow('spawn failed')
        expect(onRewindRefusal).not.toHaveBeenCalled()
        expect(onRewindTruncated).not.toHaveBeenCalled()
    })
})
