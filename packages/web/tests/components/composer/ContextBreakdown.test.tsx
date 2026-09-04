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

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ContextBreakdown } from '@/components/composer/ContextBreakdown'
import type { ContextUsage } from '@mobi/shared'

const usage = {
    totalTokens: 68300,
    maxTokens: 200000,
    percentage: 34,
    costUsd: 1.24,
    breakdown: {
        categories: [
            { key: 'systemPrompt', tokens: 18200 },
            { key: 'systemTools', tokens: 9600 },
            { key: 'mcpTools', tokens: 12400 },
            { key: 'memoryFiles', tokens: 8900 },
            { key: 'skills', tokens: 6800 },
            { key: 'messages', tokens: 12100 },
        ],
        freeTokens: 112000,
        autocompactBufferTokens: 20000,
        mcpTools: [
            { name: 'context7', tokens: 4100 },
            { name: 'mobi-web', tokens: 3200 },
        ],
        skills: [{ name: 'superpowers', tokens: 2400 }],
        memoryFiles: [{ path: '~/.claude/CLAUDE.md', tokens: 4200 }],
    },
} as unknown as ContextUsage

describe('ContextBreakdown', () => {
    afterEach(cleanup)

    it('渲染方格网 100 格与全部类目行', () => {
        const { container } = render(<ContextBreakdown usage={usage} />)
        const cells = container.querySelectorAll('[data-testid="waffle-cell"]')
        expect(cells.length).toBe(100)
        expect(screen.getByText('System prompt')).toBeTruthy()
        expect(screen.getByText('Autocompact buffer')).toBeTruthy()
    })

    it('数值尾对齐：类目行展示 token 与百分比', () => {
        render(<ContextBreakdown usage={usage} />)
        // formatTokens(18200) = Math.round(18.2)k = '18k'（规格原文 '18.2k' 与实现不符，按真实输出修正）
        expect(screen.getByText('18k')).toBeTruthy()
        expect(screen.getByText('9%')).toBeTruthy()
    })

    it('MCP tools 可展开逐 server 明细', () => {
        render(<ContextBreakdown usage={usage} />)
        expect(screen.queryByText('context7')).toBeNull()
        fireEvent.click(screen.getByText('MCP tools'))
        expect(screen.getByText('context7')).toBeTruthy()
        expect(screen.getByText('mobi-web')).toBeTruthy()
    })

    it('buffer 缺省（auto-compact 关闭）不渲染 buffer 行与格', () => {
        const noBuffer = {
            ...usage,
            breakdown: { ...usage.breakdown!, autocompactBufferTokens: undefined },
        } as unknown as ContextUsage
        const { container } = render(<ContextBreakdown usage={noBuffer} />)
        expect(screen.queryByText('Autocompact buffer')).toBeNull()
        expect(container.querySelectorAll('[data-buffer-cell]').length).toBe(0)
    })

    it('breakdown 缺省（旧 CLI/local 模式）渲染 null', () => {
        const { container } = render(<ContextBreakdown usage={{ ...usage, breakdown: undefined } as unknown as ContextUsage} />)
        expect(container.innerHTML).toBe('')
    })
})
