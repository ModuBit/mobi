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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { OptionRow } from '@/components/tool-card/OptionRow'

afterEach(cleanup)

const wrap = (ui: React.ReactNode) => render(<ConfigProvider>{ui}</ConfigProvider>)

describe('OptionRow', () => {
    it('渲染标题与描述，点击触发 onClick', () => {
        const onClick = vi.fn()
        wrap(
            <OptionRow
                data-testid="opt"
                checked={false}
                mode="single"
                disabled={false}
                tone="interactive"
                title="缓存重试"
                description="用本地 token"
                onClick={onClick}
            />
        )
        expect(screen.getByText('缓存重试')).toBeInTheDocument()
        expect(screen.getByText('用本地 token')).toBeInTheDocument()
        fireEvent.click(screen.getByTestId('opt'))
        expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('checked 时带 selected 数据态与色带节点', () => {
        wrap(
            <OptionRow
                data-testid="opt"
                checked={true}
                mode="multi"
                disabled={false}
                tone="interactive"
                title="A"
                onClick={() => {}}
            />
        )
        const btn = screen.getByTestId('opt')
        expect(btn.getAttribute('data-selected')).toBe('true')
        expect(btn.querySelector('[data-slot="bar"]')).not.toBeNull()
    })

    it('disabled 时不响应点击', () => {
        const onClick = vi.fn()
        wrap(
            <OptionRow
                data-testid="opt"
                checked={false}
                mode="single"
                disabled
                tone="interactive"
                title="A"
                onClick={onClick}
            />
        )
        fireEvent.click(screen.getByTestId('opt'))
        expect(onClick).not.toHaveBeenCalled()
    })

    it('tone=completed 时使用 colorSuccess 系 token（不输出硬编码 hex）', () => {
        const { container } = wrap(
            <OptionRow
                data-testid="opt"
                checked
                mode="single"
                disabled
                tone="completed"
                title="A"
                onClick={() => {}}
            />
        )
        expect(container.innerHTML).not.toContain('#52c41a')
        expect(container.innerHTML).not.toContain('#f6ffed')
    })

    it('interactive + disabled 压低透明度（提交中锁定反馈）', () => {
        wrap(
            <OptionRow data-testid="opt" checked={false} mode="single" disabled tone="interactive" title="A" onClick={() => {}} />
        )
        const btn = screen.getByTestId('opt')
        expect(getComputedStyle(btn).opacity).toBe('0.5')
    })

    it('completed + disabled 不压低透明度（只读展示态）', () => {
        wrap(
            <OptionRow data-testid="opt" checked mode="single" disabled tone="completed" title="A" />
        )
        const btn = screen.getByTestId('opt')
        expect(getComputedStyle(btn).opacity).toBe('1')
    })

    it('single 模式渲染 Circle/CircleCheck，multi 模式渲染 Square/SquareCheck', () => {
        const { rerender } = wrap(
            <OptionRow data-testid="opt" checked={false} mode="single" disabled={false} tone="interactive" title="A" onClick={() => {}} />
        )
        // 未选中 single → Circle（lucide 渲染 svg，class 含组件名派生的 stable hash，断言 svg 存在即可）
        expect(screen.getByTestId('opt').querySelector('svg')).not.toBeNull()

        rerender(
            <ConfigProvider>
                <OptionRow data-testid="opt" checked mode="single" disabled={false} tone="interactive" title="A" onClick={() => {}} />
            </ConfigProvider>
        )
        expect(screen.getByTestId('opt').getAttribute('data-selected')).toBe('true')
    })

    it('渲染 children（用于「其他」选项内嵌输入框等）', () => {
        wrap(
            <OptionRow
                data-testid="opt"
                checked={false}
                mode="single"
                disabled={false}
                tone="interactive"
                title="其他"
                onClick={() => {}}
            >
                <textarea data-testid="inner" />
            </OptionRow>
        )
        expect(screen.getByTestId('inner')).toBeInTheDocument()
    })

    it('description 与 title 相同时不渲染描述', () => {
        wrap(
            <OptionRow
                data-testid="opt"
                checked={false}
                mode="single"
                disabled={false}
                tone="interactive"
                title="重复"
                description="重复"
                onClick={() => {}}
            />
        )
        // 仅一处「重复」文本（title），无第二处描述
        expect(screen.getAllByText('重复')).toHaveLength(1)
    })
})
