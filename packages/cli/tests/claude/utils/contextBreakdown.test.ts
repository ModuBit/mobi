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

import { describe, it, expect } from 'vitest'
import { extractBreakdown } from '@/claude/utils/contextBreakdown'
import type { SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk'

/** 构造 SDK summary 响应的测试夹具（只填 extractBreakdown 消费的字段） */
function fixture(overrides: Partial<SDKControlGetContextUsageResponse> = {}): SDKControlGetContextUsageResponse {
    return {
        categories: [
            { name: 'System prompt', tokens: 18200, color: 'x' },
            { name: 'System tools', tokens: 8400, color: 'x' },
            { name: 'System tools (deferred)', tokens: 1200, color: 'x' },
            { name: 'MCP tools', tokens: 9200, color: 'x' },
            { name: 'MCP tools (deferred)', tokens: 3200, color: 'x' },
            { name: 'Custom agents', tokens: 500, color: 'x' },
            { name: 'Memory files', tokens: 8900, color: 'x' },
            { name: 'Skills', tokens: 6800, color: 'x' },
            { name: 'Messages', tokens: 12100, color: 'x' },
            { name: 'Free space', tokens: 112000, color: 'x' },
            { name: 'Autocompact buffer', tokens: 20000, color: 'x' },
        ],
        totalTokens: 68300,
        maxTokens: 180000,
        rawMaxTokens: 200000,
        percentage: 34,
        gridRows: [],
        model: 'claude-sonnet-5',
        memoryFiles: [
            { path: '~/.claude/CLAUDE.md', type: 'user', tokens: 4200 },
            { path: 'mobi/CLAUDE.md', type: 'project', tokens: 3100 },
        ],
        mcpTools: [
            { name: 't1', serverName: 'context7', tokens: 2500 },
            { name: 't2', serverName: 'context7', tokens: 1600 },
            { name: 't3', serverName: 'mobi-web', tokens: 3200 },
        ],
        agents: [],
        isAutoCompactEnabled: true,
        autoCompactThreshold: 180000,
        ...overrides,
    } as SDKControlGetContextUsageResponse
}

describe('extractBreakdown', () => {
    it('按 CC 顺序产出语义 key 类目，deferred 合并进主类目，agents 丢弃', () => {
        const b = extractBreakdown(fixture())!
        expect(b.categories).toEqual([
            { key: 'systemPrompt', tokens: 18200 },
            { key: 'systemTools', tokens: 9600 },   // 8400 + 1200 deferred
            { key: 'mcpTools', tokens: 12400 },      // 9200 + 3200 deferred
            { key: 'memoryFiles', tokens: 8900 },
            { key: 'skills', tokens: 6800 },
            { key: 'messages', tokens: 12100 },
        ])
    })

    it('free 与 autocompact buffer 单独成字段，不进 categories', () => {
        const b = extractBreakdown(fixture())!
        expect(b.freeTokens).toBe(112000)
        expect(b.autocompactBufferTokens).toBe(20000)
    })

    it('auto-compact 关闭时无 buffer 类目 → autocompactBufferTokens 缺省', () => {
        const b = extractBreakdown(fixture({
            categories: fixture().categories.filter(c => c.name !== 'Autocompact buffer'),
            isAutoCompactEnabled: false,
        }))!
        expect(b.autocompactBufferTokens).toBeUndefined()
    })

    it('mcpTools 按 serverName 聚合', () => {
        const b = extractBreakdown(fixture())!
        expect(b.mcpTools).toEqual([
            { name: 'context7', tokens: 4100 },
            { name: 'mobi-web', tokens: 3200 },
        ])
    })

    it('skills 取 skillFrontmatter，带 plugin 时 name 拼 "plugin:skill"', () => {
        const b = extractBreakdown(fixture({
            skills: {
                totalSkills: 2, includedSkills: 2, tokens: 300,
                skillFrontmatter: [
                    { name: 'review', source: 'plugin-a@marketplace', tokens: 200 },
                    { name: 'standalone-skill', source: 'personal', tokens: 100 },
                ],
            },
        }))!
        expect(b.skills).toEqual([
            { name: 'plugin-a:review', tokens: 200 },
            { name: 'standalone-skill', tokens: 100 },
        ])
    })

    it('skills 缺省（无 skills 字段）→ 空数组', () => {
        const b = extractBreakdown(fixture({ skills: undefined }))!
        expect(b.skills).toEqual([])
    })

    it('memoryFiles 映射 path+tokens（type 丢弃）', () => {
        const b = extractBreakdown(fixture())!
        expect(b.memoryFiles).toEqual([
            { path: '~/.claude/CLAUDE.md', tokens: 4200 },
            { path: 'mobi/CLAUDE.md', tokens: 3100 },
        ])
    })

    it('categories 为空（结构变化/失败兜底）→ 返回 null，调用方跳过', () => {
        expect(extractBreakdown(fixture({ categories: [] }))).toBeNull()
    })

    it('未知类目名忽略不抛错（CC 未来加类目前向兼容）', () => {
        const b = extractBreakdown(fixture({
            categories: [...fixture().categories, { name: 'Future thing', tokens: 999, color: 'x' }],
        }))!
        expect(b.categories.some(c => c.tokens === 999)).toBe(false)
    })
})
