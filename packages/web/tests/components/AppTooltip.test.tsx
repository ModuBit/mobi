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

import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppTooltip } from '@/components/ui/AppTooltip'

// mock antd Tooltip：open 时渲染 title（避开 portal/motion，聚焦 AppTooltip 的 open 控制逻辑）
vi.mock('antd', async orig => {
    const actual = await orig()
    return {
        ...actual,
        Tooltip: ({ open, title, children }: { open?: boolean; title?: ReactNode; children?: ReactNode }) => (
            <>
                {children}
                {open ? <div data-testid="tip">{title}</div> : null}
            </>
        ),
    }
})

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(() => {
    cleanup()
    vi.useRealTimers()
})

// 模拟"鼠标从外部进入 trigger"：pointerover（冒泡）触发 React 合成 onPointerEnter
function hoverEnter(el: Element) {
    fireEvent.pointerOver(el, { pointerType: 'mouse', relatedTarget: document.body })
    fireEvent.pointerMove(el, { pointerType: 'mouse' })
}

// 模拟"鼠标离开 trigger"：pointerout（冒泡）触发 React 合成 onPointerLeave
function hoverLeave(el: Element) {
    fireEvent.pointerOut(el, { pointerType: 'mouse', relatedTarget: document.body })
    fireEvent.pointerLeave(el, { pointerType: 'mouse' })
}

describe('AppTooltip', () => {
    it('mouse 输入：hover 显示，离开隐藏', () => {
        render(
            <AppTooltip title="hello" mouseEnterDelay={0}>
                <button>btn</button>
            </AppTooltip>,
        )
        const btn = screen.getByRole('button')
        expect(screen.queryByTestId('tip')).toBeNull()

        hoverEnter(btn)
        act(() => vi.runAllTimers())
        expect(screen.getByTestId('tip')).toBeDefined()

        hoverLeave(btn)
        expect(screen.queryByTestId('tip')).toBeNull()
    })

    it('mouseEnterDelay：延迟到期才显示', () => {
        render(
            <AppTooltip title="hello" mouseEnterDelay={0.3}>
                <button>btn</button>
            </AppTooltip>,
        )
        const btn = screen.getByRole('button')
        hoverEnter(btn)
        act(() => vi.advanceTimersByTime(299))
        expect(screen.queryByTestId('tip')).toBeNull()
        act(() => vi.advanceTimersByTime(1))
        expect(screen.getByTestId('tip')).toBeDefined()
    })

    it('touch 短按：不显示 tooltip，放行 click', () => {
        const clickSpy = vi.fn()
        render(
            <AppTooltip title="hello">
                <button onClick={clickSpy}>btn</button>
            </AppTooltip>,
        )
        const btn = screen.getByRole('button')
        fireEvent.pointerDown(btn, { pointerType: 'touch' })
        fireEvent.pointerUp(btn, { pointerType: 'touch' })
        act(() => vi.runAllTimers())
        expect(screen.queryByTestId('tip')).toBeNull()

        fireEvent.click(btn)
        expect(clickSpy).toHaveBeenCalledOnce()
    })

    it('touch 长按：显示 tooltip，并吞掉紧随的 click（不触发 action）', () => {
        const clickSpy = vi.fn()
        render(
            <AppTooltip title="hello">
                <button onClick={clickSpy}>btn</button>
            </AppTooltip>,
        )
        const btn = screen.getByRole('button')
        fireEvent.pointerDown(btn, { pointerType: 'touch' })
        expect(screen.queryByTestId('tip')).toBeNull()

        act(() => vi.advanceTimersByTime(500))
        expect(screen.getByTestId('tip')).toBeDefined()

        // long-press 命中后，click 应在捕获阶段被吞
        fireEvent.click(btn)
        expect(clickSpy).not.toHaveBeenCalled()
    })

    it('mouse hover 打开后点击 trigger 不关闭（桌面端点击不应关 hover tooltip）', () => {
        const clickSpy = vi.fn()
        render(
            <AppTooltip title="hello" mouseEnterDelay={0}>
                <button onClick={clickSpy}>btn</button>
            </AppTooltip>,
        )
        const btn = screen.getByRole('button')
        hoverEnter(btn)
        act(() => vi.runAllTimers())
        expect(screen.getByTestId('tip')).toBeDefined()

        // 鼠标点击 trigger 自身：tooltip 应保持打开（dismiss 监听仅 touch 模式挂载）
        // pointerDown 用 mouse 类型，模拟真实鼠标点击序列
        fireEvent.pointerDown(btn, { pointerType: 'mouse' })
        fireEvent.pointerUp(btn, { pointerType: 'mouse' })
        fireEvent.click(btn)
        expect(screen.getByTestId('tip')).toBeDefined()
        // click action 正常触发
        expect(clickSpy).toHaveBeenCalledOnce()
    })

    it('tooltip 显示时，外部 pointerdown 关闭', () => {
        render(
            <>
                <AppTooltip title="hello">
                    <button>btn</button>
                </AppTooltip>
                <div data-testid="outside">outside</div>
            </>,
        )
        const btn = screen.getByRole('button')
        fireEvent.pointerDown(btn, { pointerType: 'touch' })
        act(() => vi.advanceTimersByTime(500))
        expect(screen.getByTestId('tip')).toBeDefined()

        fireEvent.pointerDown(screen.getByTestId('outside'), { pointerType: 'touch' })
        expect(screen.queryByTestId('tip')).toBeNull()
    })

    it('受控模式（传 open）：不响应 pointer 分流，open 透传', () => {
        const { rerender } = render(
            <AppTooltip title="hello" open={false}>
                <button>btn</button>
            </AppTooltip>,
        )
        const btn = screen.getByRole('button')
        // hover 不显示（受控 open=false）
        hoverEnter(btn)
        act(() => vi.runAllTimers())
        expect(screen.queryByTestId('tip')).toBeNull()

        // long-press 不显示
        fireEvent.pointerDown(btn, { pointerType: 'touch' })
        act(() => vi.advanceTimersByTime(500))
        expect(screen.queryByTestId('tip')).toBeNull()

        // 外部切 true → 显示
        rerender(
            <AppTooltip title="hello" open={true}>
                <button>btn</button>
            </AppTooltip>,
        )
        expect(screen.getByTestId('tip')).toBeDefined()
    })
})
