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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { SplitLayout } from '@/components/ui/SplitLayout'
import { __resetHistoryGuardForTest } from '@/core/lib/drawerHistoryGuard'

/** 切换移动 / 桌面：mock useIsMobile 读取此变量 */
let mobile = true
vi.mock('@/core/data/hooks/useMediaQuery', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/core/data/hooks/useMediaQuery')>()
    return { ...actual, useIsMobile: () => mobile }
})

/** 桌面端分支用到 ResizeObserver，jsdom 无原生实现，stub 一个空实现 */
class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const baseProps = {
    expanded: true,
    splitRatio: 0.5,
    secondaryMaximized: false,
    onSplitRatioChange: vi.fn(),
} as const

describe('SplitLayout 移动端 history 哨兵', () => {
    beforeEach(() => {
        __resetHistoryGuardForTest()
        mobile = true
    })

    it('expanded 时推哨兵，手势返回触发 onExpandedChange(false) 收起面板', () => {
        const onExpandedChange = vi.fn()
        render(
            <SplitLayout
                {...baseProps}
                onExpandedChange={onExpandedChange}
                left="L"
                right="R"
            />,
        )
        expect(window.history.state).toMatchObject({ mobiHistoryGuard: true })
        // 模拟移动端全屏手势返回
        window.dispatchEvent(new PopStateEvent('popstate'))
        expect(onExpandedChange).toHaveBeenCalledWith(false)
    })

    it('未 expanded（收起态）时不推哨兵，手势返回交由路由层', () => {
        const before = window.history.state
        render(
            <SplitLayout
                {...baseProps}
                expanded={false}
                onExpandedChange={vi.fn()}
                left="L"
                right="R"
            />,
        )
        expect(window.history.state).toBe(before)
    })

    it('桌面端即使 expanded 也不推哨兵（桌面无全屏手势）', () => {
        mobile = false
        const before = window.history.state
        render(
            <SplitLayout
                {...baseProps}
                onExpandedChange={vi.fn()}
                left="L"
                right="R"
            />,
        )
        expect(window.history.state).toBe(before)
    })
})
