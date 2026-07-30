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

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
// 导入真实 i18n 实例并切换到 zh，让 useTranslation 返回实际翻译文本（含 {{pct}} 等插值）
import i18n from '../../src/core/config/i18n'
import { ContextUsageDetail } from '../../src/components/session/ContextUsageDetail'
import type { ContextUsage } from '@mobi/shared'

beforeAll(async () => {
    await i18n.changeLanguage('zh')
})

// autoCompactThreshold 是 token 阈值数（SDK 语义）：160000 tokens = 占 maxTokens 80%
const usage = (over: Partial<ContextUsage> = {}): ContextUsage => ({
    totalTokens: 124000,
    maxTokens: 200000,
    percentage: 62,
    autoCompactThreshold: 160000,
    isAutoCompactEnabled: true,
    categories: [
        { name: '消息历史', tokens: 62000, color: '#4d9eff' },
        { name: '工具定义', tokens: 19840 },
    ],
    apiUsage: null,
    costUsd: 0.043,
    ...over,
})

const renderDetail = (u: ContextUsage) =>
    render(<ConfigProvider><ContextUsageDetail usage={u} /></ConfigProvider>)

describe('ContextUsageDetail', () => {
    afterEach(cleanup)

    it('显示可读总量、百分比、成本', () => {
        renderDetail(usage())
        // 总量以可读形式（124k / 200k）展示，不再是 124,000
        expect(screen.getByText(/124k.*200k/)).toBeInTheDocument()
        expect(screen.getByText('62%')).toBeInTheDocument()
        expect(screen.getByText('$0.0430')).toBeInTheDocument()
    })

    it('渲染各分类名称与 token 占用', () => {
        renderDetail(usage())
        expect(screen.getByText('消息历史')).toBeInTheDocument()
        expect(screen.getByText('工具定义')).toBeInTheDocument()
        // 消息历史占 maxTokens 的 31%（62000/200000；categories 按窗口占比，加起来=100%）
        expect(screen.getByText('31%')).toBeInTheDocument()
    })

    it('有 autoCompactThreshold 时显示距压缩剩余（按 token 阈值换算）', () => {
        // threshold=160000 tokens（占 maxTokens 80%），已用 62% → 剩 18% → 约 36k tokens
        renderDetail(usage())
        expect(screen.getByText(/~18%/)).toBeInTheDocument()
        expect(screen.getByText(/36k/)).toBeInTheDocument()
    })

    it('无 autoCompactThreshold 时不显示距压缩剩余', () => {
        renderDetail(usage({ autoCompactThreshold: undefined }))
        expect(screen.queryByText(/距自动压缩/)).not.toBeInTheDocument()
    })

    it('isAutoCompactEnabled=false 时不显示距压缩剩余', () => {
        renderDetail(usage({ isAutoCompactEnabled: false }))
        expect(screen.queryByText(/距自动压缩/)).not.toBeInTheDocument()
    })

    it('百万级 token 用 m 形式展示', () => {
        renderDetail(usage({ totalTokens: 1_300_000, maxTokens: 2_000_000, percentage: 65 }))
        expect(screen.getByText(/1\.3m.*2\.0m/)).toBeInTheDocument()
    })

    it('已超 autoCompact 阈值时提示「已达阈值」而非「剩 0%」', () => {
        // threshold=160000，totalTokens=180000 已超
        renderDetail(usage({ totalTokens: 180000, percentage: 90 }))
        expect(screen.queryByText(/距自动压缩还剩/)).not.toBeInTheDocument()
        expect(screen.getByText(/已达自动压缩阈值/)).toBeInTheDocument()
    })

    it('相同 SDK 语义色名渲染为同一固定色（不随数组索引/数量漂移）', () => {
        // 场景 A：promptBorder 在索引 0（仅一项）
        const a = renderDetail(usage({
            totalTokens: 1000, maxTokens: 100000, percentage: 1,
            categories: [{ name: 'System prompt', tokens: 1000, color: 'promptBorder' }],
        }))
        const aBg = (a.container.querySelector('[data-cat="System prompt"]') as HTMLElement).style.background

        // 场景 B：promptBorder 在索引 6（前面塞 6 项，模拟 categories 增减导致索引漂移）
        const b = renderDetail(usage({
            totalTokens: 7000, maxTokens: 100000, percentage: 7,
            categories: [
                { name: 'A', tokens: 1000, color: 'claude' },
                { name: 'B', tokens: 1000, color: 'warning' },
                { name: 'C', tokens: 1000, color: 'inactive' },
                { name: 'D', tokens: 1000, color: 'cyan_FOR_SUBAGENTS_ONLY' },
                { name: 'E', tokens: 1000, color: 'purple_FOR_SUBAGENTS_ONLY' },
                { name: 'F', tokens: 1000, color: 'success' },
                { name: 'System prompt', tokens: 1000, color: 'promptBorder' },
            ],
        }))
        const bBg = (b.container.querySelector('[data-cat="System prompt"]') as HTMLElement).style.background

        // 索引从 0 → 6，promptBorder 仍映射到同一固定色，不再因回退调色板而漂移
        expect(aBg).toBe(bBg)
        expect(aBg).toMatch(/#4d9eff|rgb\(77,\s*158,\s*255\)/i)
    })

    it('Free space 中性化：大条不画彩色段，分类表用虚线灰块', () => {
        // System prompt 与 Free space 同为 promptBorder（SDK 实际如此），且 Free space 占大头
        const { container } = renderDetail(usage({
            totalTokens: 1275, maxTokens: 1000000, percentage: 1,
            categories: [
                { name: 'System prompt', tokens: 1275, color: 'promptBorder' },
                { name: 'Free space', tokens: 900959, color: 'promptBorder' },
            ],
        }))

        // 大条：Free space 不画彩色段（title 含 'Free space' 的段不存在）
        const barSegs = container.querySelectorAll('[title*="Free space"]')
        expect(barSegs).toHaveLength(0)

        // 分类表：Free space 色块透明 + 虚线边（中性「空」），System prompt 仍上色
        const freeSwatch = container.querySelector('[data-cat="Free space"]') as HTMLElement
        expect(freeSwatch.style.background).toBe('transparent')
        expect(freeSwatch.style.borderStyle).toBe('dashed')

        const sysSwatch = container.querySelector('[data-cat="System prompt"]') as HTMLElement
        expect(sysSwatch.style.background).toMatch(/#4d9eff|rgb\(77,\s*158,\s*255\)/i)
    })
})
