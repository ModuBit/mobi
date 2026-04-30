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

/**
 * metadataExtractor 单元测试
 *
 * 验证 extractSDKMetadata 传递正确的 query 参数，
 * 以及 initializationResult 到 SDKMetadata 的映射逻辑。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock @anthropic-ai/claude-agent-sdk 的 query 函数
const mockClose = vi.fn()
const mockInitializationResult = vi.fn()
const mockQuery = vi.fn()

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
    query: (...args: unknown[]) => mockQuery(...args),
}))

// mock getDefaultClaudeCodePath
const mockGetDefaultClaudeCodePath = vi.fn()
vi.mock('@/claude/sdk/utils', () => ({
    getDefaultClaudeCodePath: () => mockGetDefaultClaudeCodePath(),
}))

// mock logger
vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn() },
}))

// mock @mobi/shared 中的类型（只需要 re-export，不需要实际实现）
vi.mock('@mobi/shared', () => ({}))

// 在 mock 设置之后 import
import { extractSDKMetadata, extractSDKMetadataAsync } from '@/claude/sdk/metadataExtractor'

// 构造模拟的 initializationResult 响应
function makeInitResponse(overrides?: Record<string, unknown>) {
    return {
        commands: [
            { name: 'help', description: 'Show help', argumentHint: '' },
        ],
        agents: [
            { name: 'Explore', description: 'Search codebase' },
        ],
        output_style: 'auto',
        available_output_styles: ['auto', 'dark'],
        models: [
            { value: 'claude-sonnet-4-6', displayName: 'Sonnet', description: 'Fast' },
        ],
        account: {
            email: 'test@example.com',
            subscriptionType: 'pro',
        },
        fast_mode_state: 'off' as const,
        ...overrides,
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    mockGetDefaultClaudeCodePath.mockReturnValue('/usr/local/bin/claude')
    mockQuery.mockReturnValue({
        initializationResult: mockInitializationResult,
        close: mockClose,
    })
    mockInitializationResult.mockResolvedValue(makeInitResponse())
})

describe('extractSDKMetadata', () => {
    it('传递非空 prompt 给 query', async () => {
        await extractSDKMetadata()

        const callArgs = mockQuery.mock.calls[0][0]
        expect(callArgs.prompt).toBeTruthy()
        expect(callArgs.prompt).not.toBe('')
    })

    it('传递 pathToClaudeCodeExecutable', async () => {
        await extractSDKMetadata()

        const callArgs = mockQuery.mock.calls[0][0]
        expect(callArgs.options.pathToClaudeCodeExecutable).toBe('/usr/local/bin/claude')
    })

    it('使用空 AsyncIterable 作为 prompt 避免触发 API 调用', async () => {
        await extractSDKMetadata()

        const callArgs = mockQuery.mock.calls[0][0]
        // prompt 应该是 AsyncIterable 而非字符串
        expect(typeof callArgs.prompt).toBe('object')
        expect(callArgs.prompt[Symbol.asyncIterator]).toBeDefined()
    })

    it('不设置 maxTurns 和 allowedTools（空 prompt 无需限制）', async () => {
        await extractSDKMetadata()

        const callArgs = mockQuery.mock.calls[0][0]
        expect(callArgs.options.maxTurns).toBeUndefined()
        expect(callArgs.options.allowedTools).toBeUndefined()
    })

    it('正确映射 initializationResult 到 SDKMetadata', async () => {
        const result = await extractSDKMetadata()

        expect(result.commands).toEqual([
            { name: 'help', description: 'Show help', argumentHint: '' },
        ])
        expect(result.agents).toEqual([
            { name: 'Explore', description: 'Search codebase' },
        ])
        expect(result.outputStyle).toBe('auto')
        expect(result.availableOutputStyles).toEqual(['auto', 'dark'])
        expect(result.models).toEqual([
            { value: 'claude-sonnet-4-6', displayName: 'Sonnet', description: 'Fast' },
        ])
        expect(result.account).toEqual({
            email: 'test@example.com',
            subscriptionType: 'pro',
        })
        expect(result.fastModeState).toBe('off')
    })

    it('获取元数据后立即 close', async () => {
        await extractSDKMetadata()

        expect(mockClose).toHaveBeenCalled()
    })

    it('initializationResult 失败时返回空对象', async () => {
        mockInitializationResult.mockRejectedValue(new Error('spawn failed'))

        const result = await extractSDKMetadata()

        expect(result).toEqual({})
    })

    it('AbortError 时返回空对象', async () => {
        const abortError = new Error('Aborted')
        abortError.name = 'AbortError'
        mockInitializationResult.mockRejectedValue(abortError)

        const result = await extractSDKMetadata()

        expect(result).toEqual({})
    })

    it('init 中缺少可选字段时映射为 undefined', async () => {
        mockInitializationResult.mockResolvedValue(makeInitResponse({
            agents: undefined,
            fast_mode_state: undefined,
        }))

        const result = await extractSDKMetadata()

        expect(result.agents).toBeUndefined()
        expect(result.fastModeState).toBeUndefined()
        // commands 仍正常返回
        expect(result.commands).toHaveLength(1)
    })
})

describe('extractSDKMetadataAsync', () => {
    it('有 agents 时回调 onComplete', async () => {
        const onComplete = vi.fn()

        extractSDKMetadataAsync(onComplete)

        await new Promise(r => setTimeout(r, 50))
        expect(onComplete).toHaveBeenCalledOnce()

        const metadata = onComplete.mock.calls[0][0]
        expect(metadata.agents).toHaveLength(1)
    })

    it('有 commands 时也回调 onComplete', async () => {
        mockInitializationResult.mockResolvedValue(makeInitResponse({
            agents: undefined,
        }))

        const onComplete = vi.fn()

        extractSDKMetadataAsync(onComplete)

        await new Promise(r => setTimeout(r, 50))
        expect(onComplete).toHaveBeenCalledOnce()

        const metadata = onComplete.mock.calls[0][0]
        expect(metadata.commands).toHaveLength(1)
    })

    it('agents 和 commands 都为 undefined 时不回调 onComplete', async () => {
        mockInitializationResult.mockResolvedValue(makeInitResponse({
            commands: undefined,
            agents: undefined,
        }))

        const onComplete = vi.fn()

        extractSDKMetadataAsync(onComplete)

        // 等待足够时间确认不会调用
        await new Promise(resolve => setTimeout(resolve, 50))
        expect(onComplete).not.toHaveBeenCalled()
    })

    it('提取失败时不回调 onComplete', async () => {
        mockInitializationResult.mockRejectedValue(new Error('failed'))

        const onComplete = vi.fn()

        extractSDKMetadataAsync(onComplete)

        await new Promise(resolve => setTimeout(resolve, 50))
        expect(onComplete).not.toHaveBeenCalled()
    })
})
