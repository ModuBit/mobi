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
})
