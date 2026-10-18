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

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { Popover } from '@/ui/base/interactive/popover/Popover'

// jsdom 没有 ResizeObserver：floating-ui 的 autoUpdate 需要
beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})

afterEach(() => {
    cleanup()
    vi.useRealTimers()
})

function renderPopover(props: Partial<React.ComponentProps<typeof Popover>> = {}) {
    return render(
        <Popover content={<div>面板内容</div>} {...props}>
            <button type="button">触发</button>
        </Popover>,
    )
}

const panel = () => document.querySelector('[data-mobi-popover]')

describe('Popover click 触发', () => {
    it('点击 trigger 打开，再点关闭', () => {
        renderPopover({ trigger: 'click' })
        const trigger = screen.getByRole('button', { name: '触发' })

        fireEvent.click(trigger)
        expect(screen.getByText('面板内容')).toBeInTheDocument()

        fireEvent.click(trigger)
        expect(screen.queryByText('面板内容')).not.toBeInTheDocument()
    })

    it('点外关闭', async () => {
        renderPopover({ trigger: 'click' })
        fireEvent.click(screen.getByRole('button', { name: '触发' }))
        expect(screen.getByText('面板内容')).toBeInTheDocument()

        // DismissableLayer 在挂载后的 setTimeout(0) 才挂 pointerdown 监听
        await new Promise((resolve) => setTimeout(resolve, 0))
        // 非模态层把 pointerdown 延迟到随后的 click 才判定（deferPointerDownOutside）
        fireEvent.pointerDown(document.body, { button: 0 })
        fireEvent.click(document.body)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(screen.queryByText('面板内容')).not.toBeInTheDocument()
    })

    it('Escape 关闭', () => {
        renderPopover({ trigger: 'click' })
        fireEvent.click(screen.getByRole('button', { name: '触发' }))
        expect(screen.getByText('面板内容')).toBeInTheDocument()

        fireEvent.keyDown(document, { key: 'Escape' })
        expect(screen.queryByText('面板内容')).not.toBeInTheDocument()
    })
})

describe('Popover hover 触发', () => {
    it('悬停延迟打开，离开延迟关闭', () => {
        vi.useFakeTimers()
        renderPopover({ trigger: 'hover', openDelay: 100, closeDelay: 160 })
        const trigger = screen.getByRole('button', { name: '触发' })

        fireEvent.pointerEnter(trigger, { pointerType: 'mouse' })
        expect(screen.queryByText('面板内容')).not.toBeInTheDocument()
        act(() => vi.advanceTimersByTime(100))
        expect(screen.getByText('面板内容')).toBeInTheDocument()

        fireEvent.pointerLeave(trigger, { pointerType: 'mouse' })
        act(() => vi.advanceTimersByTime(160))
        expect(screen.queryByText('面板内容')).not.toBeInTheDocument()
    })

    it('指针移入面板后不关闭（交互内容可用）', () => {
        vi.useFakeTimers()
        renderPopover({ trigger: 'hover', openDelay: 0, closeDelay: 160 })
        const trigger = screen.getByRole('button', { name: '触发' })

        fireEvent.pointerEnter(trigger, { pointerType: 'mouse' })
        act(() => vi.advanceTimersByTime(0))
        const content = panel() as HTMLElement
        expect(content).toBeTruthy()

        fireEvent.pointerLeave(trigger, { pointerType: 'mouse' })
        fireEvent.pointerEnter(content, { pointerType: 'mouse' })
        act(() => vi.advanceTimersByTime(500))
        expect(screen.getByText('面板内容')).toBeInTheDocument()

        fireEvent.pointerLeave(content, { pointerType: 'mouse' })
        act(() => vi.advanceTimersByTime(160))
        expect(screen.queryByText('面板内容')).not.toBeInTheDocument()
    })

    it('触屏 pointerType 不触发 hover', () => {
        vi.useFakeTimers()
        renderPopover({ trigger: 'hover', openDelay: 0 })
        const trigger = screen.getByRole('button', { name: '触发' })

        fireEvent.pointerEnter(trigger, { pointerType: 'touch' })
        act(() => vi.advanceTimersByTime(500))
        expect(screen.queryByText('面板内容')).not.toBeInTheDocument()
    })

    it('键盘 Enter 打开', () => {
        renderPopover({ trigger: 'hover' })
        const trigger = screen.getByRole('button', { name: '触发' })

        fireEvent.keyDown(trigger, { key: 'Enter' })
        expect(screen.getByText('面板内容')).toBeInTheDocument()
    })
})

describe('Popover hover + click 触发', () => {
    it('click 钉住后移出不关闭，再点关闭', () => {
        vi.useFakeTimers()
        renderPopover({ trigger: ['hover', 'click'], openDelay: 0, closeDelay: 100 })
        const trigger = screen.getByRole('button', { name: '触发' })

        fireEvent.pointerEnter(trigger, { pointerType: 'mouse' })
        act(() => vi.advanceTimersByTime(0))
        expect(screen.getByText('面板内容')).toBeInTheDocument()

        fireEvent.click(trigger)
        fireEvent.pointerLeave(trigger, { pointerType: 'mouse' })
        act(() => vi.advanceTimersByTime(500))
        expect(screen.getByText('面板内容')).toBeInTheDocument()

        act(() => fireEvent.click(trigger))
        act(() => vi.advanceTimersByTime(200))
        expect(screen.queryByText('面板内容')).not.toBeInTheDocument()
    })
})

describe('Popover manual 触发', () => {
    function ManualHarness() {
        const [open, setOpen] = useState(false)
        return (
            <Popover trigger="manual" open={open} onOpenChange={setOpen} content={<div>面板内容</div>}>
                <button type="button" onClick={() => {}}>触发</button>
            </Popover>
        )
    }

    it('点击 trigger 不改变打开态（由外部控制）', () => {
        render(<ManualHarness />)
        const trigger = screen.getByRole('button', { name: '触发' })

        fireEvent.click(trigger)
        expect(screen.queryByText('面板内容')).not.toBeInTheDocument()
    })

    it('外部受控打开后点外关闭', async () => {
        let setter: ((value: boolean) => void) | null = null
        function Harness() {
            const [open, setOpen] = useState(false)
            setter = setOpen
            return (
                <Popover trigger="manual" open={open} onOpenChange={setOpen} content={<div>面板内容</div>}>
                    <button type="button">触发</button>
                </Popover>
            )
        }
        render(<Harness />)

        await act(async () => setter?.(true))
        expect(screen.getByText('面板内容')).toBeInTheDocument()

        // DismissableLayer 在挂载后的 setTimeout(0) 才挂 pointerdown 监听
        await new Promise((resolve) => setTimeout(resolve, 0))
        // 非模态层把 pointerdown 延迟到随后的 click 才判定（deferPointerDownOutside）
        fireEvent.pointerDown(document.body, { button: 0 })
        fireEvent.click(document.body)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(screen.queryByText('面板内容')).not.toBeInTheDocument()
    })
})

describe('Popover 渲染与焦点', () => {
    it('面板带 data-mobi-popover / data-state，panelClassName 与 arrow 生效', () => {
        renderPopover({ trigger: 'click', arrow: true, panelClassName: 'custom-panel' })
        fireEvent.click(screen.getByRole('button', { name: '触发' }))

        const content = panel() as HTMLElement
        expect(content).toBeTruthy()
        expect(content.dataset.state).toBe('open')
        expect(content).toHaveClass('custom-panel')
        expect(content.querySelector('svg')).toBeTruthy()
    })

    it('鼠标打开不抢焦点，键盘打开才聚焦面板', () => {
        const { unmount } = renderPopover({ trigger: 'click' })
        fireEvent.click(screen.getByRole('button', { name: '触发' }))
        expect(screen.getByText('面板内容')).toBeInTheDocument()
        expect(panel()?.contains(document.activeElement)).toBe(false)
        unmount()

        renderPopover({ trigger: 'hover' })
        fireEvent.keyDown(screen.getByRole('button', { name: '触发' }), { key: 'Enter' })
        expect(screen.getByText('面板内容')).toBeInTheDocument()
        expect(panel()?.contains(document.activeElement)).toBe(true)
    })

    it('受控 open 切换控制内容挂载', () => {
        const { rerender } = render(
            <Popover trigger="click" open={false} content={<div>面板内容</div>}>
                <button type="button">触发</button>
            </Popover>,
        )
        expect(screen.queryByText('面板内容')).not.toBeInTheDocument()

        rerender(
            <Popover trigger="click" open content={<div>面板内容</div>}>
                <button type="button">触发</button>
            </Popover>,
        )
        expect(screen.getByText('面板内容')).toBeInTheDocument()
    })
})
