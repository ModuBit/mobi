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
import { OptionRow } from '@/features/chat/tool-card/OptionRow'

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

    it('checked 时带 selected 数据态与实色选中边框', () => {
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
        expect(btn.getAttribute('aria-checked')).toBe('true')
        // 不再有左侧色带（四重堆叠已收敛）
        expect(btn.querySelector('[data-slot="bar"]')).toBeNull()
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
        // token 化完成态：成功色只允许经 --control-* CSS 变量投影（token 运行时取值），
        // 不允许硬编码在常规 CSS 属性（jsdom 把变量值保留 hex 原样，常规属性转 rgb——据此区分）
        const html = container.innerHTML
        expect(html).toContain('--control-on')
        // 常规属性路径若出现 hex 会以 `property: #52c41a` 形态存在；变量取值行以 `--control-*: #52c41a` 结尾
        const hexLines = html.match(/[-a-z]+\s*:\s*#52c41a/g) ?? []
        expect(hexLines.every((m) => m.startsWith('--control-'))).toBe(true)
        expect(html).not.toContain('#f6ffed')
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

    it('single 模式渲染 uiarc RadioIndicator，multi 模式渲染 uiarc Checkbox', () => {
        const { rerender } = wrap(
            <OptionRow data-testid="opt" checked={false} mode="single" disabled={false} tone="interactive" title="A" onClick={() => {}} />
        )
        // single → uiarc RadioIndicator（圆点指示器，aria-hidden 纯视觉）
        expect(screen.getByTestId('opt').querySelector('span[class*="indicator"]')).not.toBeNull()

        rerender(
            <ConfigProvider>
                <OptionRow data-testid="opt" checked mode="multi" disabled={false} tone="interactive" title="A" onClick={() => {}} />
            </ConfigProvider>
        )
        // multi → uiarc Checkbox（Radix button role=checkbox，纯视觉内嵌于 aria-hidden mark span）
        expect(screen.getByTestId('opt').querySelector('button[role="checkbox"]')).not.toBeNull()
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

    it('subtitle 始终渲染，即使与 title 相同（区别于 description 的相等守卫）', () => {
        wrap(
            <OptionRow
                data-testid="opt"
                checked
                mode="single"
                disabled
                tone="completed"
                title="(custom answer)"
                subtitle="(custom answer)"
            />
        )
        // title + subtitle 两处都应出现（subtitle 不被 title 相等守卫吞掉）
        expect(screen.getAllByText('(custom answer)')).toHaveLength(2)
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
