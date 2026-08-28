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

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { AppTooltip } from '@/components/ui/AppTooltip'

// antd Tooltip（rc-trigger）依赖 ResizeObserver，jsdom 未提供
beforeAll(() => {
    class FakeResizeObserver {
        observe() { /* noop */ }
        unobserve() { /* noop */ }
        disconnect() { /* noop */ }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})

afterEach(cleanup)

/**
 * AppTooltip 的 wrapper span 用 display:contents（零布局影响），Chrome 对无盒元素
 * getBoundingClientRect() 恒返回零矩形，antd Tooltip（rc-align）以该元素为定位目标
 * 时对齐失效——悬停期间 tooltip 停在屏外，关闭动画阶段被 overflow 钳制到视口左下角
 * 播放（用户可见的「移开瞬间左下角闪一下」）。
 *
 * 修复契约：wrapper 的 getBoundingClientRect 在零矩形时必须委托给其内容的联合矩形
 * （Range 跨 display:contents 生效），rc-align 拿到真实矩形后定位恢复正常。
 * jsdom 无真实布局，这里通过 mock Range 来锁定委托行为本身。
 */
describe('AppTooltip', () => {
    it('wrapper 零矩形时 getBoundingClientRect 委托给内容联合矩形', () => {
        const contentRect = {
            x: 40, y: 80, width: 206, height: 22,
            top: 80, right: 246, bottom: 102, left: 40,
            toJSON: () => ({}),
        }
        const selectNodeContents = vi.fn()
        const createRangeSpy = vi.spyOn(document, 'createRange').mockReturnValue({
            selectNodeContents,
            getBoundingClientRect: () => contentRect,
        } as unknown as Range)

        const { getByTestId } = render(
            <AppTooltip title="tip" open>
                <span data-testid="trigger-child">hover target</span>
            </AppTooltip>,
        )

        // wrapper = Tooltip 定位目标（child 的直接父级 span，display:contents）
        const wrapper = getByTestId('trigger-child').parentElement
        expect(wrapper).not.toBeNull()
        // jsdom 无布局，原生 rect 天然是零矩形 → 触发委托
        const rect = wrapper!.getBoundingClientRect()
        expect(selectNodeContents).toHaveBeenCalledWith(wrapper)
        expect(rect.width).toBe(contentRect.width)
        expect(rect.height).toBe(contentRect.height)
        expect(rect.x).toBe(contentRect.x)
        expect(rect.y).toBe(contentRect.y)

        createRangeSpy.mockRestore()
    })

    it('内容联合矩形也为零时回退返回原始零矩形', () => {
        const createRangeSpy = vi.spyOn(document, 'createRange').mockReturnValue({
            selectNodeContents: vi.fn(),
            getBoundingClientRect: () => ({
                x: 0, y: 0, width: 0, height: 0,
                top: 0, right: 0, bottom: 0, left: 0,
                toJSON: () => ({}),
            }),
        } as unknown as Range)

        const { getByTestId } = render(
            <AppTooltip title="tip" open>
                <span data-testid="trigger-child">hover target</span>
            </AppTooltip>,
        )

        const wrapper = getByTestId('trigger-child').parentElement!
        const rect = wrapper.getBoundingClientRect()
        expect(rect.width).toBe(0)
        expect(rect.height).toBe(0)

        createRangeSpy.mockRestore()
    })
})
