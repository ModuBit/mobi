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

    it('tone=completed 用 success 色调（断言不再含硬编码 #52c41a）', () => {
        const { container } = render(
            <ConfigProvider>
                <OptionRow
                    data-testid="opt"
                    checked
                    mode="single"
                    disabled
                    tone="completed"
                    title="A"
                    onClick={() => {}}
                />
            </ConfigProvider>
        )
        expect(container.innerHTML).not.toContain('#52c41a')
        expect(container.innerHTML).not.toContain('#f6ffed')
    })
})
