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
    handleRewindRefusal,
    type RewindRefusalHandlerDeps,
} from '../../src/claude/utils/rewindRefusal'
import { claudeRemote } from '../../src/claude/claudeRemote'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
    query: vi.fn(),
    startup: vi.fn(),
}))
vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), debugLargeJson: vi.fn() },
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

    it('onRewindRefusal 未定义 + refusal → 按普通 startup 失败向上抛（防御门控）', async () => {
        // 防御：非 rewind 轮若误配 refusal 前缀错误，不应静默 return 丢错误——
        // 门控 onRewindRefusal 已定义才走 recovery，否则按普通 startup 失败向上抛
        mockedStartup.mockRejectedValue(new Error(`${REWIND_REFUSAL_PREFIX} unexpected`))

        const opts = {
            ...truncationOpts(),
            onRewindTruncated: vi.fn().mockResolvedValue(undefined),
            // 不带 onRewindRefusal
        }

        await expect(claudeRemote(opts)).rejects.toThrow(REWIND_REFUSAL_PREFIX)
    })
})

/**
 * 路径 B 端到端测试（spec E1）：startup 成功 → onRewindTruncated 报告成功 →
 * warmRef.query 返回首个 result 是 error_during_execution + refusal 前缀 →
 * sdkOutputLoop 检测 → 调 onRewindRefusal + 短路（不调 onReady/onContextUsage）。
 */
describe('claudeRemote rewind refusal recovery（路径 B：result is_error）', () => {
    beforeEach(() => {
        mockedStartup.mockReset()
    })

    it('首个 result 是 refusal error → 调 onRewindRefusal + 短路（不调 onReady/onContextUsage）', async () => {
        const refusalMsg = `${REWIND_REFUSAL_PREFIX} truncated range contains queued message`
        // 构造只产出一条 refusal result 然后结束的 Query 流
        const refusalResult = {
            type: 'result' as const,
            subtype: 'error_during_execution',
            is_error: true,
            errors: [refusalMsg],
            terminal_reason: 'error_during_execution',
            duration_ms: 0,
            duration_api_ms: 0,
            num_turns: 0,
            stop_reason: null,
            total_cost_usd: 0,
            usage: {},
            modelUsage: {},
            permission_denials: [],
            uuid: 'test-uuid',
            session_id: 'test-session',
        }
        const fakeQuery = {
            [Symbol.asyncIterator]() {
                let yielded = false
                return {
                    async next() {
                        if (yielded) return { done: true, value: undefined }
                        yielded = true
                        return { done: false, value: refusalResult }
                    },
                }
            },
            close: vi.fn(),
        }
        const warmRef = { query: vi.fn().mockReturnValue(fakeQuery), close: vi.fn() }
        mockedStartup.mockResolvedValue(warmRef as never)

        const onRewindRefusal = vi.fn()
        const onRewindTruncated = vi.fn().mockResolvedValue(undefined)
        const onReady = vi.fn()
        const onContextUsage = vi.fn()

        const opts = {
            ...truncationOpts(),
            nextMessage: vi.fn().mockResolvedValue({
                message: 'hello', mode: { permissionMode: 'default' as const }, localIds: ['loc-1'],
            }),
            onRewindTruncated,
            onRewindRefusal,
            onReady,
            onContextUsage,
        }

        await claudeRemote(opts)

        // onRewindTruncated 已触发（startup 成功后报告截断成功）
        expect(onRewindTruncated).toHaveBeenCalledTimes(1)
        // refusal result 触发 onRewindRefusal
        expect(onRewindRefusal).toHaveBeenCalledTimes(1)
        expect(onRewindRefusal).toHaveBeenCalledWith(refusalMsg)
        // 短路验证：refusal result 不走正常 turn 收尾
        expect(onReady).not.toHaveBeenCalled()
        expect(onContextUsage).not.toHaveBeenCalled()
    })

    it('首个 result 非 refusal error（普通错误）→ 不调 onRewindRefusal', async () => {
        const normalErrorResult = {
            type: 'result' as const,
            subtype: 'error_during_execution',
            is_error: true,
            errors: ['some other runtime error'],
            terminal_reason: 'error_during_execution',
            duration_ms: 0,
            duration_api_ms: 0,
            num_turns: 0,
            stop_reason: null,
            total_cost_usd: 0,
            usage: {},
            modelUsage: {},
            permission_denials: [],
            uuid: 'test-uuid',
            session_id: 'test-session',
        }
        const fakeQuery = {
            [Symbol.asyncIterator]() {
                let yielded = false
                return {
                    async next() {
                        if (yielded) return { done: true, value: undefined }
                        yielded = true
                        return { done: false, value: normalErrorResult }
                    },
                }
            },
            close: vi.fn(),
        }
        const warmRef = { query: vi.fn().mockReturnValue(fakeQuery), close: vi.fn() }
        mockedStartup.mockResolvedValue(warmRef as never)

        const onRewindRefusal = vi.fn()
        const onReady = vi.fn()

        const opts = {
            ...truncationOpts(),
            nextMessage: vi.fn().mockResolvedValue({
                message: 'hello', mode: { permissionMode: 'default' as const }, localIds: ['loc-1'],
            }),
            onRewindTruncated: vi.fn().mockResolvedValue(undefined),
            onRewindRefusal,
            onReady,
        }

        await claudeRemote(opts)

        // 非 refusal error 不触发 onRewindRefusal
        expect(onRewindRefusal).not.toHaveBeenCalled()
        // 正常走 turn 收尾（onReady 被调用）
        expect(onReady).toHaveBeenCalled()
    })

    it('refusal 前缀 result 但 onRewindRefusal 未定义（非 rewind 轮）→ 不短路，走正常 turn 收尾（onReady 被调）', async () => {
        const refusalMsg = `${REWIND_REFUSAL_PREFIX} truncated range contains queued message`
        const refusalResult = {
            type: 'result' as const,
            subtype: 'error_during_execution',
            is_error: true,
            errors: [refusalMsg],
            terminal_reason: 'error_during_execution',
            duration_ms: 0,
            duration_api_ms: 0,
            num_turns: 0,
            stop_reason: null,
            total_cost_usd: 0,
            usage: {},
            modelUsage: {},
            permission_denials: [],
            uuid: 'test-uuid',
            session_id: 'test-session',
        }
        const fakeQuery = {
            [Symbol.asyncIterator]() {
                let yielded = false
                return {
                    async next() {
                        if (yielded) return { done: true, value: undefined }
                        yielded = true
                        return { done: false, value: refusalResult }
                    },
                }
            },
            close: vi.fn(),
        }
        // 常规轮（无 resumeSessionAt）→ onRewindRefusal 未定义
        const warmRef = { query: vi.fn().mockReturnValue(fakeQuery), close: vi.fn() }
        // 用 startup 成功 + 不传 resumeSessionAt 模拟常规轮
        mockedStartup.mockResolvedValue(warmRef as never)

        const onReady = vi.fn()
        const onContextUsage = vi.fn()

        const opts = {
            ...truncationOpts(),
            resumeSessionAt: undefined,
            resumeDropsTurn: undefined,
            // 不传 onRewindTruncated / onRewindRefusal —— 模拟非 rewind 轮
            nextMessage: vi.fn().mockResolvedValue({
                message: 'hello', mode: { permissionMode: 'default' as const }, localIds: ['loc-1'],
            }),
            onReady,
            onContextUsage,
        }

        await claudeRemote(opts)

        // refusal 前缀 result 但 onRewindRefusal 未定义 → 不短路 → onReady 被调（F3 修复）
        expect(onReady).toHaveBeenCalled()
        // onContextUsage 也应被调（非中断 result）
        expect(onContextUsage).toHaveBeenCalled()
    })
})

/**
 * handleRewindRefusal launcher handler 单测（A/B 分流 + 真实 filesRestored/skippedLinks 透传）。
 * 路径 A（pendingRewind 非空）：clear + emitRewindCompleted(pendingRewind.filesRestored, msg, skippedLinks) + 不发 sendSessionEvent。
 * 路径 B（pendingRewind 已空）：emitRewindCompleted(fallbackRewindData.filesRestored, msg, skippedLinks) + 发 sendSessionEvent 兜底。
 */
describe('handleRewindRefusal（launcher handler A/B 分流）', () => {
    const REFUSAL_MSG = `${REWIND_REFUSAL_PREFIX} truncated range contains queued message`

    /** 构造 handler deps mock */
    function makeDeps(opts: {
        pendingRewind?: RewindRefusalHandlerDeps['pendingRewind']
        fallbackRewindData?: RewindRefusalHandlerDeps['fallbackRewindData']
    } = {}): RewindRefusalHandlerDeps & {
        emitRewindCompleted: ReturnType<typeof vi.fn>
        sendSessionEvent: ReturnType<typeof vi.fn>
        clearPendingRewind: ReturnType<typeof vi.fn>
    } {
        return {
            pendingRewind: opts.pendingRewind ?? null,
            fallbackRewindData: opts.fallbackRewindData ?? null,
            clearPendingRewind: vi.fn(),
            emitRewindCompleted: vi.fn(),
            sendSessionEvent: vi.fn(),
        }
    }

    it('路径 A（pendingRewind 非空, filesRestored=true, skippedLinks=3）→ clear + emitRewindCompleted(true, msg, 3) + 不发 sendSessionEvent', () => {
        const deps = makeDeps({
            pendingRewind: { nativeId: 'u1', resumeAt: 'a1', filesRestored: true, skippedLinks: 3 },
        })

        handleRewindRefusal(deps, REFUSAL_MSG)

        // 路径 A：clear 被调用
        expect(deps.clearPendingRewind).toHaveBeenCalledTimes(1)
        // emitRewindCompleted 传真实 filesRestored + skippedLinks（F1/F5 修复）
        expect(deps.emitRewindCompleted).toHaveBeenCalledTimes(1)
        expect(deps.emitRewindCompleted).toHaveBeenCalledWith(true, `rewind rejected: ${REFUSAL_MSG}`, 3)
        // 路径 A 不发 sendSessionEvent（progress 条目仍在，corrective emit 有效，无需兜底）
        expect(deps.sendSessionEvent).not.toHaveBeenCalled()
    })

    it('路径 A（filesRestored=false, skippedLinks undefined）→ emitRewindCompleted(false, msg, undefined)', () => {
        const deps = makeDeps({
            pendingRewind: { nativeId: 'u1', resumeAt: 'a1', filesRestored: false },
        })

        handleRewindRefusal(deps, REFUSAL_MSG)

        expect(deps.emitRewindCompleted).toHaveBeenCalledWith(false, `rewind rejected: ${REFUSAL_MSG}`, undefined)
    })

    it('路径 B（pendingRewind 已空, fallbackRewindData 有值）→ emitRewindCompleted(true, msg, 3) + 发 sendSessionEvent 兜底', () => {
        const deps = makeDeps({
            pendingRewind: null,
            fallbackRewindData: { filesRestored: true, skippedLinks: 3 },
        })

        handleRewindRefusal(deps, REFUSAL_MSG)

        // 路径 B：clear 不被调用（pendingRewind 已被 onRewindTruncated 清空）
        expect(deps.clearPendingRewind).not.toHaveBeenCalled()
        // emitRewindCompleted 传 fallback 的真实 filesRestored + skippedLinks（F1/F5 修复）
        expect(deps.emitRewindCompleted).toHaveBeenCalledTimes(1)
        expect(deps.emitRewindCompleted).toHaveBeenCalledWith(true, `rewind rejected: ${REFUSAL_MSG}`, 3)
        // 路径 B 兜底：sendSessionEvent 让用户看到 refusal 原因
        expect(deps.sendSessionEvent).toHaveBeenCalledTimes(1)
        expect(deps.sendSessionEvent).toHaveBeenCalledWith({
            type: 'message',
            message: `rewind rejected: ${REFUSAL_MSG}`,
        })
    })

    it('路径 B（pendingRewind 空, fallbackRewindData 也空）→ emitRewindCompleted(false, msg, undefined)', () => {
        const deps = makeDeps({ pendingRewind: null, fallbackRewindData: null })

        handleRewindRefusal(deps, REFUSAL_MSG)

        expect(deps.emitRewindCompleted).toHaveBeenCalledWith(false, `rewind rejected: ${REFUSAL_MSG}`, undefined)
        expect(deps.sendSessionEvent).toHaveBeenCalledTimes(1)
    })
})
