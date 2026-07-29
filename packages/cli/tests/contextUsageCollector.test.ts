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
import type { Query, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import { ContextUsageCollector } from '../src/claude/utils/contextUsageCollector'

/** 构造一个含「前端用不到的大字段」的完整 SDK 响应，验证裁剪 */
function makeRawResponse() {
    return {
        categories: [
            { name: 'messages', tokens: 62000, color: '#4d9eff', isDeferred: false },
            { name: 'tools', tokens: 19840, color: '#f0883e' },
        ],
        totalTokens: 124000,
        maxTokens: 200000,
        rawMaxTokens: 200000,
        percentage: 62,
        gridRows: [[{ color: '#fff', isFilled: true, categoryName: 'x', tokens: 1, percentage: 1, squareFullness: 1 }]],
        model: 'opus',
        memoryFiles: [{ path: '/x', type: 'md', tokens: 100 }],
        mcpTools: [{ name: 'mobi', serverName: 'mobi', tokens: 200 }],
        deferredBuiltinTools: [{ name: 'Bash', tokens: 300, isLoaded: true }],
        systemTools: [{ name: 'Read', tokens: 50 }],
        agents: [{ agentType: 'general', source: 's', tokens: 10 }],
        slashCommands: { totalCommands: 5, includedCommands: 3, tokens: 80 },
        skills: { totalSkills: 2, includedSkills: 1, tokens: 40, skillFrontmatter: [] },
        autoCompactThreshold: 78,
        isAutoCompactEnabled: true,
        apiUsage: {
            input_tokens: 2100,
            output_tokens: 8400,
            cache_read_input_tokens: 88000,
            cache_creation_input_tokens: 1400,
        },
    } as unknown as Awaited<ReturnType<Query['getContextUsage']>>
}

function makeQuery(raw: unknown, impl?: () => Promise<unknown>) {
    return {
        getContextUsage: vi.fn(impl ?? (() => Promise.resolve(raw))),
    } as unknown as Query
}

describe('ContextUsageCollector', () => {
    it('裁剪掉前端用不到的大字段，只保留仪表盘所需字段', async () => {
        const collector = new ContextUsageCollector()
        const usage = await collector.collect(makeQuery(makeRawResponse()))

        expect(usage).not.toBeNull()
        expect(usage!.totalTokens).toBe(124000)
        expect(usage!.maxTokens).toBe(200000)
        expect(usage!.percentage).toBe(62)
        expect(usage!.autoCompactThreshold).toBe(78)
        expect(usage!.isAutoCompactEnabled).toBe(true)
        expect(usage!.categories).toEqual([
            { name: 'messages', tokens: 62000, color: '#4d9eff' },
            { name: 'tools', tokens: 19840, color: '#f0883e' },
        ])
        expect(usage!.apiUsage).toEqual({
            input_tokens: 2100,
            output_tokens: 8400,
            cache_read_input_tokens: 88000,
            cache_creation_input_tokens: 1400,
        })
        // 大字段不应出现
        expect((usage as unknown as Record<string, unknown>).gridRows).toBeUndefined()
        expect((usage as unknown as Record<string, unknown>).mcpTools).toBeUndefined()
        expect((usage as unknown as Record<string, unknown>).skills).toBeUndefined()
        expect((usage as unknown as Record<string, unknown>).memoryFiles).toBeUndefined()
    })

    it('resultMsg.total_cost_usd 更新累计成本', async () => {
        const collector = new ContextUsageCollector()
        const result = { total_cost_usd: 0.043, num_turns: 1 } as unknown as SDKResultMessage
        const usage = await collector.collect(makeQuery(makeRawResponse()), result)
        expect(usage!.costUsd).toBe(0.043)
    })

    it('无 resultMsg 时沿用上次累计成本', async () => {
        const collector = new ContextUsageCollector()
        const result = { total_cost_usd: 0.05 } as unknown as SDKResultMessage
        await collector.collect(makeQuery(makeRawResponse()), result)

        // 第二次不传 resultMsg，应沿用 0.05
        const usage2 = await collector.collect(makeQuery(makeRawResponse()))
        expect(usage2!.costUsd).toBe(0.05)
    })

    it('初始累计成本为 0', async () => {
        const collector = new ContextUsageCollector()
        const usage = await collector.collect(makeQuery(makeRawResponse()))
        expect(usage!.costUsd).toBe(0)
    })

    it('getContextUsage 抛错时返回 null（错误隔离，不抛）', async () => {
        const collector = new ContextUsageCollector()
        const query = makeQuery(null, () => Promise.reject(new Error('rpc down')))
        const usage = await collector.collect(query)
        expect(usage).toBeNull()
    })

    it('apiUsage 为 null 时透传 null', async () => {
        const collector = new ContextUsageCollector()
        const raw = { ...makeRawResponse(), apiUsage: null }
        const usage = await collector.collect(makeQuery(raw))
        expect(usage!.apiUsage).toBeNull()
    })

    it('reset 后累计成本归零', async () => {
        const collector = new ContextUsageCollector()
        const result = { total_cost_usd: 0.09 } as unknown as SDKResultMessage
        await collector.collect(makeQuery(makeRawResponse()), result)
        collector.reset()
        const usage = await collector.collect(makeQuery(makeRawResponse()))
        expect(usage!.costUsd).toBe(0)
    })
})
