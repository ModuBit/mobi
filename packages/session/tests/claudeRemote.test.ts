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

import { describe, it, expect, vi } from 'vitest'
import {
    handleSpecialCommand,
    createSpecialCommandContext,
    buildBashInjectionText,
    sdkOutputLoop,
    type SpecialCommandContext,
    type LoopContext,
} from '../src/claude/claudeRemote'
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'

describe('handleSpecialCommand', () => {
    const createMockContext = (): SpecialCommandContext => {
        const calls = {
            clear: 0,
            compact: 0,
            bash: [] as string[],
            ready: 0,
        }
        return {
            onClear: () => { calls.clear += 1 },
            onCompactStart: () => { calls.compact += 1 },
            executeBash: async (cmd: string) => { calls.bash.push(cmd) },
            onReady: () => { calls.ready += 1 },
            // 添加 getter 用于测试验证
            _calls: calls,
        } as SpecialCommandContext & { _calls: typeof calls }
    }

    it('should handle /clear command', async () => {
        const ctx = createMockContext() as ReturnType<typeof createMockContext>
        const result = await handleSpecialCommand('/clear', ctx)

        expect(result).toEqual({
            handled: true,
            shouldExit: true,
            isCompact: false,
        })
        expect(ctx._calls.clear).toBe(1)
        expect(ctx._calls.compact).toBe(0)
        expect(ctx._calls.bash).toHaveLength(0)
    })

    it('should handle /compact command', async () => {
        const ctx = createMockContext() as ReturnType<typeof createMockContext>
        const result = await handleSpecialCommand('/compact', ctx)

        expect(result).toEqual({
            handled: true,
            shouldExit: false,
            isCompact: true,
        })
        expect(ctx._calls.clear).toBe(0)
        expect(ctx._calls.compact).toBe(1)
        expect(ctx._calls.bash).toHaveLength(0)
    })

    it('should handle !bash command', async () => {
        const ctx = createMockContext() as ReturnType<typeof createMockContext>
        const result = await handleSpecialCommand('! echo hello', ctx)

        expect(result).toEqual({
            handled: true,
            shouldExit: false,
            isCompact: false,
        })
        expect(ctx._calls.clear).toBe(0)
        expect(ctx._calls.compact).toBe(0)
        expect(ctx._calls.bash).toEqual(['echo hello'])
        expect(ctx._calls.ready).toBe(1)
    })

    it('should return unhandled for normal message', async () => {
        const ctx = createMockContext() as ReturnType<typeof createMockContext>
        const result = await handleSpecialCommand('Hello, Claude!', ctx)

        expect(result).toEqual({
            handled: false,
            shouldExit: false,
            isCompact: false,
        })
        expect(ctx._calls.clear).toBe(0)
        expect(ctx._calls.compact).toBe(0)
        expect(ctx._calls.bash).toHaveLength(0)
    })

    it('should handle /clear with extra whitespace', async () => {
        const ctx = createMockContext() as ReturnType<typeof createMockContext>
        const result = await handleSpecialCommand('/clear  ', ctx)

        expect(result.handled).toBe(true)
        expect(result.shouldExit).toBe(true)
    })

    it('!bash 命令把 localIds 透传给 executeBash 作第二参', async () => {
        const executeBash = vi.fn()
        const ctx = {
            onClear: vi.fn(),
            onCompactStart: vi.fn(),
            executeBash,
            onReady: vi.fn(),
        } as unknown as ReturnType<typeof createMockContext>
        const result = await handleSpecialCommand('! echo hi', ctx, ['l1'])

        expect(result.handled).toBe(true)
        // localIds 原样透传，供 executeBash 把注入消息与 mobi 消息绑定
        expect(executeBash).toHaveBeenCalledWith('echo hi', ['l1'])
    })
})

describe('createSpecialCommandContext', () => {
    it('should create context with all callbacks', () => {
        const onCompletionEvent = vi.fn()
        const onContextCleared = vi.fn()
        const onSessionReset = vi.fn()
        const onReady = vi.fn()
        const executeBash = vi.fn()

        // onCompactStart 统一转 launcher 幂等收口（不再走 onCompletionEvent 字符串文案）
        const onCompactStart = vi.fn()

        const ctx = createSpecialCommandContext(
            { onCompletionEvent, onContextCleared, onSessionReset, onCompactStart, onReady },
            executeBash
        )

        // Test onClear
        ctx.onClear()
        expect(onContextCleared).toHaveBeenCalled()
        expect(onSessionReset).toHaveBeenCalled()

        // Test onCompactStart（times(1) 锁定单次转发；幂等契约本身由 CompactStartGate 单测覆盖）
        ctx.onCompactStart()
        expect(onCompactStart).toHaveBeenCalledTimes(1)
        expect(onCompletionEvent).not.toHaveBeenCalledWith('Compaction started')

        // Test onReady
        ctx.onReady()
        expect(onReady).toHaveBeenCalled()
    })

    it('should work with optional callbacks undefined', () => {
        const onReady = vi.fn()
        const executeBash = vi.fn()

        const ctx = createSpecialCommandContext(
            { onReady },
            executeBash
        )

        // Should not throw
        ctx.onClear()
        ctx.onCompactStart()
        ctx.onReady()

        expect(onReady).toHaveBeenCalled()
    })

    it('should fallback to onCompletionEvent when onContextCleared is not provided', () => {
        const onCompletionEvent = vi.fn()
        const onSessionReset = vi.fn()
        const onReady = vi.fn()

        const ctx = createSpecialCommandContext(
            { onCompletionEvent, onSessionReset, onReady },
            vi.fn()
        )

        ctx.onClear()
        expect(onCompletionEvent).toHaveBeenCalledWith('Context was reset')
        expect(onSessionReset).toHaveBeenCalled()
    })
})

describe('buildBashInjectionText', () => {
    it('用 CLI 原生标签包裹命令与输出，并标明已本地执行、无需重复执行', () => {
        const text = buildBashInjectionText('ls -la', 'file1\nfile2', '', false)
        expect(text).toContain('<bash-input>ls -la</bash-input>')
        // stdout/stderr 同行拼接
        expect(text).toContain('<bash-stdout>file1\nfile2</bash-stdout><bash-stderr></bash-stderr>')
        expect(text).toContain('本地')
        // 明确告知模型不要重复执行
        expect(text).toMatch(/无需重复执行|不要重复|不必重复/)
    })

    it('hasError=true 时标注失败，stderr 有内容', () => {
        const text = buildBashInjectionText('false', '', 'oops', true)
        expect(text).toMatch(/失败|错误/)
        expect(text).toContain('<bash-stdout></bash-stdout><bash-stderr>oops</bash-stderr>')
    })

    it('转义输出中的 XML 特殊字符，避免破坏标签', () => {
        const text = buildBashInjectionText('echo a<b>&c', 'a<b>&c', '', false)
        expect(text).toContain('<bash-input>echo a&lt;b&gt;&amp;c</bash-input>')
        expect(text).toContain('<bash-stdout>a&lt;b&gt;&amp;c</bash-stdout>')
        // 原始尖括号不应泄漏到标签内容
        expect(text).not.toContain('a<b>&c')
    })
})

describe('sdkOutputLoop contextUsage 分发', () => {
    type SnapshotSender = Parameters<typeof sdkOutputLoop>[2]['snapshotSender']

    const mockQuery = (msgs: SDKMessage[]): Query =>
        ({ async *[Symbol.asyncIterator]() { for (const m of msgs) yield m } }) as unknown as Query

    const mockSnapshotSender = (): SnapshotSender =>
        ({ flush: vi.fn(), consumePendingFull: vi.fn(() => null) }) as unknown as SnapshotSender

    const baseOpts = () => ({
        path: '/tmp',
        onMessage: vi.fn(),
        snapshotSender: mockSnapshotSender(),
        onSessionFound: vi.fn(),
        onReady: vi.fn(),
        onRunningChange: vi.fn(),
    })

    it('conversation_reset 触发 onConversationReset 带 trigger 与 new_conversation_id', async () => {
        const onConversationReset = vi.fn()
        await sdkOutputLoop(
            mockQuery([{
                type: 'conversation_reset',
                new_conversation_id: 'new-conv-uuid',
                uuid: 'frame-uuid',
                session_id: 'sess-uuid',
                trigger: 'plan_mode_exit',
                timestamp: '2026-09-28T08:00:00.000Z',
            } as unknown as SDKMessage]),
            { isCompactCommand: false } satisfies LoopContext,
            { ...baseOpts(), onConversationReset },
        )
        expect(onConversationReset).toHaveBeenCalledWith({ trigger: 'plan_mode_exit', newConversationId: 'new-conv-uuid' })
    })

    it('conversation_reset 的 trigger 缺省（旧 emitter）仍触发，trigger 传 undefined', async () => {
        const onConversationReset = vi.fn()
        await sdkOutputLoop(
            mockQuery([{
                type: 'conversation_reset',
                new_conversation_id: 'new-conv-uuid',
                uuid: 'frame-uuid',
                session_id: 'sess-uuid',
            } as unknown as SDKMessage]),
            { isCompactCommand: false } satisfies LoopContext,
            { ...baseOpts(), onConversationReset },
        )
        expect(onConversationReset).toHaveBeenCalledWith({ trigger: undefined, newConversationId: 'new-conv-uuid' })
    })

    it('未接线 onConversationReset 时 conversation_reset 不炸（可选能力位）', async () => {
        await expect(sdkOutputLoop(
            mockQuery([{
                type: 'conversation_reset',
                new_conversation_id: 'new-conv-uuid',
                uuid: 'frame-uuid',
                session_id: 'sess-uuid',
            } as unknown as SDKMessage]),
            { isCompactCommand: false } satisfies LoopContext,
            baseOpts(),
        )).resolves.toBeUndefined()
    })

    it('system:init 带 plugin_errors → 合成 warning 级 informational 落库（web 横幅复用 informational 管线）', async () => {
        const onMessage = vi.fn()
        await sdkOutputLoop(
            mockQuery([{
                type: 'system', subtype: 'init', session_id: 'sess-1',
                plugin_errors: [
                    { plugin: 'inline[0]', type: 'path-not-found', message: 'dir missing', path: '/tmp/bad-plugin' },
                    { plugin: 'foo@market', type: 'dependency-unsatisfied', message: 'needs x' },
                ],
            } as unknown as SDKMessage]),
            { isCompactCommand: false } satisfies LoopContext,
            { ...baseOpts(), onMessage, synthesizedPluginErrorContents: new Set() },
        )
        const synthesized = onMessage.mock.calls
            .map(([m]) => m)
            .find((m: { type?: string; subtype?: string }) => m.type === 'system' && m.subtype === 'informational') as
            | { content: string; level: string; session_id: string }
            | undefined
        expect(synthesized).toBeDefined()
        expect(synthesized!.level).toBe('warning')
        expect(synthesized!.session_id).toBe('sess-1')
        expect(synthesized!.content).toContain('inline[0]')
        expect(synthesized!.content).toContain('path-not-found')
        expect(synthesized!.content).toContain('/tmp/bad-plugin')
        expect(synthesized!.content).toContain('foo@market')
        expect(synthesized!.content).toContain('\n')
    })

    it('system:init 无 plugin_errors → 不合成 informational 行', async () => {
        const onMessage = vi.fn()
        await sdkOutputLoop(
            mockQuery([{ type: 'system', subtype: 'init', session_id: 'sess-1' } as unknown as SDKMessage]),
            { isCompactCommand: false } satisfies LoopContext,
            { ...baseOpts(), onMessage },
        )
        const synthesized = onMessage.mock.calls
            .map(([m]) => m)
            .find((m: { type?: string; subtype?: string }) => m.type === 'system' && m.subtype === 'informational')
        expect(synthesized).toBeUndefined()
    })

    it('同一会话跨 query 重启重带相同 plugin_errors → 内容去重只合成一次（横幅不随重启堆叠）', async () => {
        const onMessage = vi.fn()
        const signatures = new Set<string>()
        const initFrame = {
            type: 'system', subtype: 'init', session_id: 'sess-1',
            plugin_errors: [{ plugin: 'inline[0]', type: 'generic-error', message: 'boom' }],
        }
        const run = () => sdkOutputLoop(
            mockQuery([initFrame as unknown as SDKMessage]),
            { isCompactCommand: false } satisfies LoopContext,
            { ...baseOpts(), onMessage, synthesizedPluginErrorContents: signatures },
        )
        await run()
        await run()
        await run()
        const synthesizedCount = onMessage.mock.calls
            .map(([m]) => m)
            .filter((m: { type?: string; subtype?: string }) => m.type === 'system' && m.subtype === 'informational')
            .length
        expect(synthesizedCount).toBe(1)
    })

    it('conversation_reset → 对 new_conversation_id 走 onSessionFound（transcript 挂接：converter/scanner 切到新对话文件）', async () => {
        // awaitFileExist 按真实路径等文件：临时目录预置 <id>.jsonl 使其立即命中
        const { mkdtempSync, writeFileSync } = await import('node:fs')
        const { tmpdir } = await import('node:os')
        const { join } = await import('node:path')
        const dir = mkdtempSync(join(tmpdir(), 'mobi-conv-reset-'))
        writeFileSync(join(dir, 'new-conv-id.jsonl'), '')
        const sessionPaths = await import('../src/claude/utils/path')
        const pathSpy = vi.spyOn(sessionPaths, 'getProjectPath').mockReturnValue(dir)

        try {
            const onSessionFound = vi.fn()
            await sdkOutputLoop(
                mockQuery([{
                    type: 'conversation_reset',
                    new_conversation_id: 'new-conv-id',
                    uuid: 'frame-uuid',
                    session_id: 'old-conv-id',
                    trigger: 'plan_mode_exit',
                } as unknown as SDKMessage]),
                { isCompactCommand: false } satisfies LoopContext,
                { ...baseOpts(), onSessionFound },
            )
            // 异步上报：轮询等 awaitFileExist then 链执行
            for (let i = 0; i < 50 && onSessionFound.mock.calls.length === 0; i++) {
                await new Promise(r => setTimeout(r, 10))
            }
            expect(onSessionFound).toHaveBeenCalledWith('new-conv-id')
        } finally {
            pathSpy.mockRestore()
        }
    })

    it('compact_boundary 触发 onCompactBoundary 带 post_tokens', async () => {
        const onCompactBoundary = vi.fn()
        await sdkOutputLoop(
            mockQuery([{
                type: 'system', subtype: 'compact_boundary',
                compact_metadata: { trigger: 'manual', pre_tokens: 46400, post_tokens: 1900 },
            } as unknown as SDKMessage]),
            { isCompactCommand: false } satisfies LoopContext,
            { ...baseOpts(), onCompactBoundary },
        )
        expect(onCompactBoundary).toHaveBeenCalledWith(1900)
    })

    it('compact_boundary 的 post_tokens 缺失时传 undefined', async () => {
        const onCompactBoundary = vi.fn()
        await sdkOutputLoop(
            mockQuery([{
                type: 'system', subtype: 'compact_boundary',
                compact_metadata: { trigger: 'manual', pre_tokens: 46400 },
            } as unknown as SDKMessage]),
            { isCompactCommand: false } satisfies LoopContext,
            { ...baseOpts(), onCompactBoundary },
        )
        expect(onCompactBoundary).toHaveBeenCalledWith(undefined)
    })

    it('compact 的 result 仍调 onContextUsage(isCompact=true) 回填成本，并触发 onCompactCompleted', async () => {
        const onContextUsage = vi.fn()
        const onCompactCompleted = vi.fn()
        await sdkOutputLoop(
            mockQuery([{ type: 'result', subtype: 'success', terminal_reason: undefined } as unknown as SDKMessage]),
            { isCompactCommand: true } satisfies LoopContext,
            { ...baseOpts(), onContextUsage, onCompactCompleted },
        )
        // isCompact=true：用量由 compact_boundary 上报，此处只回填成本，故仍回调
        expect(onContextUsage).toHaveBeenCalledWith(expect.anything(), true)
        expect(onCompactCompleted).toHaveBeenCalled()
    })

    it('中断的 result（aborted_streaming）跳过 onContextUsage', async () => {
        const onContextUsage = vi.fn()
        await sdkOutputLoop(
            mockQuery([{ type: 'result', subtype: 'success', terminal_reason: 'aborted_streaming' } as unknown as SDKMessage]),
            { isCompactCommand: false } satisfies LoopContext,
            { ...baseOpts(), onContextUsage },
        )
        expect(onContextUsage).not.toHaveBeenCalled()
    })

    it('正常 result 触发 onContextUsage', async () => {
        const onContextUsage = vi.fn()
        await sdkOutputLoop(
            mockQuery([{ type: 'result', subtype: 'success', terminal_reason: undefined } as unknown as SDKMessage]),
            { isCompactCommand: false } satisfies LoopContext,
            { ...baseOpts(), onContextUsage },
        )
        expect(onContextUsage).toHaveBeenCalled()
    })

    it('conversation_reset 不触发 onContextCleared（plan-mode exit 也发此消息，无法与 /clear 区分）', async () => {
        const onContextCleared = vi.fn()
        await sdkOutputLoop(
            // conversation_reset 是顶层 type（SDKConversationResetMessage）
            mockQuery([{ type: 'conversation_reset', new_conversation_id: 'n', uuid: 'u', session_id: 's' } as unknown as SDKMessage]),
            { isCompactCommand: false } satisfies LoopContext,
            { ...baseOpts(), onContextCleared },
        )
        expect(onContextCleared).not.toHaveBeenCalled()
    })
})
