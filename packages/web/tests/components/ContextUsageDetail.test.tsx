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
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { ContextUsageDetail } from '../../src/components/session/ContextUsageDetail'
import type { ContextUsage } from '@mobi/shared'

const usage = (over: Partial<ContextUsage> = {}): ContextUsage => ({
    totalTokens: 124000,
    maxTokens: 200000,
    percentage: 62,
    autoCompactThreshold: 78,
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

    it('显示总量、百分比、成本', () => {
        renderDetail(usage())
        expect(screen.getByText(/124,000.*200,000/)).toBeInTheDocument()
        expect(screen.getByText('62%')).toBeInTheDocument()
        expect(screen.getByText('$0.0430')).toBeInTheDocument()
    })

    it('渲染各分类名称与 token 占用', () => {
        renderDetail(usage())
        expect(screen.getByText('消息历史')).toBeInTheDocument()
        expect(screen.getByText('工具定义')).toBeInTheDocument()
        // 消息历史占 totalTokens 的 50%（62000/124000）
        expect(screen.getByText('50%')).toBeInTheDocument()
    })

    it('有 autoCompactThreshold 时显示距压缩剩余', () => {
        renderDetail(usage()) // 阈值 78，已用 62 → 剩 16% → 约 32000 tokens
        expect(screen.getByText(/~16%/)).toBeInTheDocument()
        expect(screen.getByText(/32,000/)).toBeInTheDocument()
    })

    it('无 autoCompactThreshold 时不显示距压缩剩余', () => {
        renderDetail(usage({ autoCompactThreshold: undefined }))
        expect(screen.queryByText(/距自动压缩/)).not.toBeInTheDocument()
    })

    it('isAutoCompactEnabled=false 时不显示距压缩剩余', () => {
        renderDetail(usage({ isAutoCompactEnabled: false }))
        expect(screen.queryByText(/距自动压缩/)).not.toBeInTheDocument()
    })
})
