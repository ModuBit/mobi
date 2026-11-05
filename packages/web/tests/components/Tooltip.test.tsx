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

import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { Tooltip } from '@/ui/base/interactive/tooltip/Tooltip'

afterEach(cleanup)

describe('Tooltip', () => {
    it('hover 不打开（打开态只由受控 open 决定）', () => {
        const { rerender } = render(
            <Tooltip open={false} content={<span>提示内容</span>}>
                <button type="button">触发</button>
            </Tooltip>,
        )
        const trigger = screen.getByRole('button', { name: '触发' })
        fireEvent.pointerMove(trigger, { pointerType: 'mouse' })
        fireEvent.pointerEnter(trigger, { pointerType: 'mouse' })
        expect(screen.queryByText('提示内容')).not.toBeInTheDocument()

        rerender(
            <Tooltip open content={<span>提示内容</span>}>
                <button type="button">触发</button>
            </Tooltip>,
        )
        expect(screen.getByText('提示内容')).toBeInTheDocument()
    })

    it('点击 trigger 不关闭 hover 打开的 tooltip；点外仍关闭', async () => {
        const onOpenChange = vi.fn()
        render(
            <Tooltip open onOpenChange={onOpenChange} content={<span>提示内容</span>}>
                <button type="button">触发</button>
            </Tooltip>,
        )
        const trigger = screen.getByRole('button', { name: '触发' })

        // Radix Trigger 自身会在 pointerdown / click 时发 onClose，必须忽略
        fireEvent.pointerDown(trigger, { pointerType: 'mouse', button: 0 })
        fireEvent.click(trigger)
        expect(onOpenChange).not.toHaveBeenCalled()
        expect(screen.getByText('提示内容')).toBeInTheDocument()

        // 点外关闭要照常转发（DismissableLayer 在挂载后的 setTimeout(0) 才挂监听）
        await new Promise((resolve) => setTimeout(resolve, 0))
        fireEvent.pointerDown(document.body, { button: 0 })
        fireEvent.click(document.body)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('字符串内容走尺寸动画容器，data-state 与方位落到浮层', async () => {
        render(
            <Tooltip open side="right" align="start" content="纯文本">
                <button type="button">触发</button>
            </Tooltip>,
        )
        // 字符串内容同时渲染测量层与可视层，取第一个
        const content = (await screen.findAllByText('纯文本'))[0]
        const bubble = content.closest('[data-state]') as HTMLElement
        expect(bubble).toBeTruthy()
        expect(bubble.dataset.state).toMatch(/open$/)
        expect(bubble.dataset.side).toBe('right')
        expect(bubble.dataset.align).toBe('start')
    })

    it('受控打开后 Radix 内建 delayed-open timer 到点不自毁', () => {
        // 根因（真机实锤）：全受控封装下，Trigger 内建 delayed-open timer（原默认 700ms）与
        // AppTooltip 的 mouseEnterDelay（如 0.5s）并行计时；timer 到点时闭包里的 prop 仍是旧值
        // false，setOpen(true) 被判为「值有变化」→ dispatch tooltip.open 互斥广播 → 把自己关掉，
        // 表现为 tooltip 打开约 200ms 后自灭。修复 = delayDuration 0，让内建请求立即上抛被忽略。
        // 这里的受控 wrapper 模拟 AppTooltip 的契约：忽略打开请求、接受关闭请求。
        // 注：自毁链路在 jsdom + fake timers 下无法复现（timer 回调闭包拿到的 prop 是新值，
        // stale closure 不触发；根因与修复均经真机 E2E 验证），本测试作为行为护栏，
        // 锁「受控打开后越过原 700ms 时刻不消失」这一结果。
        function AppTooltipLike() {
            const [open, setOpen] = useState(false)
            return (
                <Tooltip open={open} onOpenChange={(next) => { if (next) return; setOpen(false) }} content="纯文本">
                    <button type="button" onClick={() => setOpen(true)}>触发</button>
                </Tooltip>
            )
        }
        vi.useFakeTimers()
        try {
            render(<AppTooltipLike />)
            const trigger = screen.getByRole('button', { name: '触发' })
            // 启动 Radix Trigger 内建 hover 打开 timer（监听 onPointerMove，与受控打开并行）
            fireEvent.pointerMove(trigger, { pointerType: 'mouse' })
            // 受控方在其 mouseEnterDelay 到点后打开（pointerDown+click 走 triggerPressRef 忽略 Radix 的点击关闭）
            fireEvent.pointerDown(trigger, { pointerType: 'mouse', button: 0 })
            fireEvent.click(trigger)
            expect(screen.getAllByText('纯文本').length).toBeGreaterThan(0)
            // 越过 Radix 原 700ms delayed-open 时刻：tooltip 必须仍然开着
            act(() => { vi.advanceTimersByTime(700) })
            expect(screen.getAllByText('纯文本').length).toBeGreaterThan(0)
        } finally {
            vi.useRealTimers()
        }
    })
})
