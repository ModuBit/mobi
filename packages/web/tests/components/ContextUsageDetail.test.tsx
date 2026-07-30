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
        // 消息历史占 totalTokens 的 50%（62000/124000）
        expect(screen.getByText('50%')).toBeInTheDocument()
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
})
