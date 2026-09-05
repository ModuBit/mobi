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
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import i18n from '../../src/core/config/i18n'
import { formatEvent } from '../../src/domain/chat'
import type { AgentEvent } from '../../src/domain/chat/types'

beforeAll(async () => {
    await i18n.changeLanguage('zh')
})

const renderEvent = (event: AgentEvent) =>
    render(<ConfigProvider>{formatEvent(event, k => k) as React.ReactNode}</ConfigProvider>)

describe('formatEvent turn-result', () => {
    afterEach(cleanup)

    const baseEvent: AgentEvent = {
        type: 'turn-result',
        durationMs: 13200,
        tokens: 263,
        numTurns: 2,
        ttftMs: 800,
        costUsd: 0.001,
        inputTokens: 50,
        outputTokens: 213,
        cacheReadTokens: 46000,
        cacheCreationTokens: 1200,
        model: 'glm-5.2',
    }

    it('收起态显示「duration · N tokens」概要', () => {
        renderEvent(baseEvent)
        expect(screen.getByText(/13\.2s · 263 tokens/)).toBeInTheDocument()
    })

    it('点击概要展开详情（耗时/首token/轮次/模型/成本/token 细分）', () => {
        renderEvent(baseEvent)
        fireEvent.click(screen.getByRole('button'))
        // 标签
        expect(screen.getByText('耗时')).toBeInTheDocument()
        expect(screen.getByText('首 token')).toBeInTheDocument()
        expect(screen.getByText('轮次')).toBeInTheDocument()
        expect(screen.getByText('模型')).toBeInTheDocument()
        expect(screen.getByText('成本')).toBeInTheDocument()
        expect(screen.getByText('缓存读')).toBeInTheDocument()
        // 值
        expect(screen.getByText('glm-5.2')).toBeInTheDocument()
        expect(screen.getByText(/\$0\.0010/)).toBeInTheDocument()
        expect(screen.getByText(/46k/)).toBeInTheDocument()
    })

    it('无详情字段时不可展开（无 ▸ 指示符、无 button 点击展开）', () => {
        // 只有 duration/tokens，没有 numTurns/cost/usage 细分
        renderEvent({ type: 'turn-result', durationMs: 1000, tokens: 10, numTurns: null })
        expect(screen.queryByText('▾')).not.toBeInTheDocument()
        // 概要仍显示
        expect(screen.getByText(/1\.0s/)).toBeInTheDocument()
    })

    it('tokens===0（本地命令如 /usage）只显示 耗时·时间，不显示 token、不可展开', () => {
        // /usage 等不调主模型的本地命令：result.usage 为 0，即便 result 带 numTurns 也不展开
        renderEvent({ type: 'turn-result', durationMs: 800, tokens: 0, numTurns: 1 })
        // 耗时显示
        expect(screen.getByText(/800ms/)).toBeInTheDocument()
        // 无 ▸/▾ 指示符、无 role=button（非交互元素，a11y 友好）
        expect(screen.queryByText('▸')).not.toBeInTheDocument()
        expect(screen.queryByText('▾')).not.toBeInTheDocument()
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
        // 不展开（即便带 numTurns 也不渲染「轮次」详情标签）
        expect(screen.queryByText('轮次')).not.toBeInTheDocument()
        // 不显示 token 数（无「N tokens」字样）
        expect(screen.queryByText(/tokens/)).not.toBeInTheDocument()
    })

    it('含缓存命中率时概要显示 ⚡N%，详情含总输入与命中率行', () => {
        // cr=91 in=5 cc=4 → 总输入 100、命中率 91%
        renderEvent({
            ...baseEvent,
            inputTokens: 5,
            outputTokens: 213,
            cacheReadTokens: 91,
            cacheCreationTokens: 4,
            totalInputTokens: 100,
            cacheHitRate: 91,
        })
        // 概要：· ⚡91%（整数值不带假小数尾——历史落库整数与新数据真精度靠小数位有无区分）
        expect(screen.getByText(/⚡91%/)).toBeInTheDocument()
        // 展开详情：总输入（含缓存）= 100、缓存命中 = 91%
        fireEvent.click(screen.getByRole('button'))
        expect(screen.getByText('总输入（含缓存）')).toBeInTheDocument()
        expect(screen.getByText('缓存命中')).toBeInTheDocument()
        expect(screen.getByText(/^100$/)).toBeInTheDocument()
        expect(screen.getByText('91%')).toBeInTheDocument()
    })

    it('无缓存数据（usage 只有 input/output）不显示 ⚡ 与命中率详情行', () => {
        renderEvent({
            type: 'turn-result',
            durationMs: 13200,
            tokens: 263,
            numTurns: 2,
            ttftMs: 800,
            inputTokens: 50,
            outputTokens: 213,
        })
        // 概要无 ⚡
        expect(screen.queryByText(/⚡/)).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button'))
        // 详情无总输入/命中率行
        expect(screen.queryByText('总输入（含缓存）')).not.toBeInTheDocument()
        expect(screen.queryByText('缓存命中')).not.toBeInTheDocument()
    })
})

// 防漏网根因（与 goal-progress 同坑）：auto-compact 时 SDK 发 compact_boundary，
// normalizeAgent 已产出 {type:'compact'} 事件，但 formatEvent 缺 case 落 default:return null
// → 聊天里完全无提示（手动 /compact 有 user 消息 + compact-summary 撑着看不出）。
describe('formatEvent compact / microcompact', () => {
    afterEach(cleanup)

    // formatEvent 的 t 由调用方注入（真实渲染走 i18n），测试用最小映射解析文案
    const zhT = (k: string) =>
        ({ 'chat.contextCompacted': '上下文已压缩', 'chat.contextMicrocompacted': '上下文已微压缩' })[k] ?? k

    const renderCompactEvent = (event: AgentEvent) =>
        render(<ConfigProvider>{formatEvent(event, zhT) as React.ReactNode}</ConfigProvider>)

    it('compact 事件渲染压缩统计（label · pre → post tokens · 耗时）', () => {
        renderCompactEvent({
            type: 'compact',
            trigger: 'auto',
            preTokens: 318983,
            postTokens: 30326,
            durationMs: 140848,
        })
        expect(screen.getByText(/上下文已压缩/)).toBeInTheDocument()
        expect(screen.getByText(/319\.0k/)).toBeInTheDocument()
        expect(screen.getByText(/30\.3k/)).toBeInTheDocument()
        expect(screen.getByText(/2m 20s/)).toBeInTheDocument()
    })

    it('compact 缺耗时时只显示 token 变化（数据缺失容错）', () => {
        renderCompactEvent({
            type: 'compact',
            trigger: 'manual',
            preTokens: 1000,
            postTokens: 500,
            durationMs: 0,
        })
        expect(screen.getByText(/上下文已压缩/)).toBeInTheDocument()
        expect(screen.getByText(/1\.0k/)).toBeInTheDocument()
        expect(screen.getByText(/→ 500/)).toBeInTheDocument()
    })

    it('microcompact 事件渲染节省 token 数', () => {
        renderCompactEvent({
            type: 'microcompact',
            trigger: 'auto',
            preTokens: 50000,
            tokensSaved: 45000,
        })
        expect(screen.getByText(/上下文已微压缩/)).toBeInTheDocument()
        expect(screen.getByText(/45\.0k tokens/)).toBeInTheDocument()
    })
})

// 防漏网根因：Task 7 只测到 normalize 层，没跨 reducer→render，
// 导致 formatEvent 缺 goal-progress case（落 default:return null）无人发现。
// 此 describe 覆盖 reducer→render 全链：formatEvent 对 goal-progress 返回非 null JSX
describe('formatEvent goal-progress', () => {
    afterEach(cleanup)

    it('met=false 渲染 ◎ goal active + condition + 统计', () => {
        renderEvent({
            type: 'goal-progress',
            met: false,
            condition: '所有测试通过',
            iterations: 3,
            durationMs: 45000,
            tokens: 1234,
        })
        // 状态文案
        expect(screen.getByText('◎ goal active')).toBeInTheDocument()
        // condition 文本
        expect(screen.getByText(/所有测试通过/)).toBeInTheDocument()
        // 统计：3 turns · 45.0s · 1.2k tokens
        expect(screen.getByText(/3 turns/)).toBeInTheDocument()
        expect(screen.getByText(/45\.0s/)).toBeInTheDocument()
        expect(screen.getByText(/1\.2k tokens/)).toBeInTheDocument()
    })

    it('met=true 渲染 ✓ goal 达成', () => {
        renderEvent({
            type: 'goal-progress',
            met: true,
            condition: 'lint 零警告',
        })
        expect(screen.getByText('✓ goal 达成')).toBeInTheDocument()
        expect(screen.getByText(/lint 零警告/)).toBeInTheDocument()
        // 无统计字段时不渲染 stats 段
        expect(screen.queryByText(/turns/)).not.toBeInTheDocument()
    })

    it('无统计字段时不渲染 stats 段（只有 状态 · condition）', () => {
        renderEvent({
            type: 'goal-progress',
            met: false,
            condition: 'build 成功',
        })
        expect(screen.getByText('◎ goal active')).toBeInTheDocument()
        expect(screen.queryByText(/turns/)).not.toBeInTheDocument()
        expect(screen.queryByText(/tokens/)).not.toBeInTheDocument()
    })
})
