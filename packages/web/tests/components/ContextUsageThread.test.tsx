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
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { ContextUsageThread } from '../../src/components/composer/ContextUsageThread'
import type { ContextUsage } from '@mobi/shared'

const usage = (over: Partial<ContextUsage> = {}): ContextUsage => ({
    totalTokens: 124000,
    maxTokens: 200000,
    percentage: 62,
    autoCompactThreshold: 160000,
    isAutoCompactEnabled: true,
    categories: [{ name: 'messages', tokens: 62000 }],
    apiUsage: null,
    costUsd: 0.043,
    ...over,
})

const renderThread = (u: ContextUsage) =>
    render(<ConfigProvider><ContextUsageThread usage={u} /></ConfigProvider>)

describe('ContextUsageThread', () => {
    afterEach(cleanup)

    it('默认显示已用 tokens（k）', () => {
        renderThread(usage())
        expect(screen.getByText('124k')).toBeInTheDocument()
    })

    it('点击数字切换到百分比，再点切回 tokens', () => {
        renderThread(usage())
        fireEvent.click(screen.getByText('124k'))
        expect(screen.getByText('62%')).toBeInTheDocument()
        fireEvent.click(screen.getByText('62%'))
        expect(screen.getByText('124k')).toBeInTheDocument()
    })

    it('tokens < 1000 时显示原值', () => {
        renderThread(usage({ totalTokens: 800 }))
        // 默认即显示 tokens，无需点击
        expect(screen.getByText('800')).toBeInTheDocument()
    })

    it('percentage 钳制到 0–100', () => {
        renderThread(usage({ percentage: 150 }))
        // 默认显示 tokens，点击切到百分比后才看到钳制后的 100%
        fireEvent.click(screen.getByText('124k'))
        expect(screen.getByText('100%')).toBeInTheDocument()
    })
})
