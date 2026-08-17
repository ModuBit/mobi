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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MobileDrawer } from '@/components/ui/MobileDrawer'
import { __resetHistoryGuardForTest } from '@/core/lib/drawerHistoryGuard'

describe('MobileDrawer', () => {
    beforeEach(() => __resetHistoryGuardForTest())

    // vitest 未开 globals，须显式 cleanup；否则 drawer portal 跨用例累积，
    // querySelector 会抓到前一用例残留的 .ant-drawer-body（默认样式），断言失真
    afterEach(() => cleanup())

    it('渲染、open 切换、卸载均不抛异常（#4 复位 effect / #9 卸载 cleanup）', () => {
        const onClose = vi.fn()
        const { rerender, unmount } = render(
            <MobileDrawer open onClose={onClose} title="测试" />,
        )

        // 模拟快速 close→reopen，触发 #4 的 [open] 复位 effect，不应抛异常或卡死
        rerender(<MobileDrawer open={false} onClose={onClose} title="测试" />)
        rerender(<MobileDrawer open onClose={onClose} title="测试" />)

        // 卸载触发 #9 的定时器 cleanup，残留定时器应被清理
        unmount()

        // 未触发手势关闭，onClose 不应被调用
        expect(onClose).not.toHaveBeenCalled()
    })

    it('open 时推 history 哨兵，手势返回（popstate）触发 onClose 关闭 drawer', () => {
        const onClose = vi.fn()
        render(<MobileDrawer open onClose={onClose} title="测试" />)
        // open 即应推入哨兵
        expect(window.history.state).toMatchObject({ mobiHistoryGuard: true })
        // 模拟移动端全屏手势返回
        window.dispatchEvent(new PopStateEvent('popstate'))
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('open=false 时不推哨兵（不干扰路由层 history）', () => {
        const onClose = vi.fn()
        const before = window.history.state
        render(<MobileDrawer open={false} onClose={onClose} title="测试" />)
        expect(window.history.state).toBe(before)
    })

    it('body overflow 强制 hidden：调用方传 overflow 覆盖也不生效（拖拽把手必须固定，不随内容滚动）', () => {
        const onClose = vi.fn()
        render(
            <MobileDrawer
                open
                onClose={onClose}
                title="测试"
                // 复现 MobileMenu 曾传入的破坏性覆盖：body 变滚动容器后把手会随内容滚走
                styles={{ body: { padding: 0, overflow: 'auto' } }}
            >
                <div>内容</div>
            </MobileDrawer>,
        )
        const body = document.querySelector('.ant-drawer-body') as HTMLElement
        expect(body).toBeTruthy()
        expect(body.style.overflow).toBe('hidden')
    })

    it('body 必须带与 wrapper 同值的 maxHeight：内容超限时 body 收缩、由内部滚动区滚，而非 section/wrapper 滚走把手', () => {
        const onClose = vi.fn()
        render(
            <MobileDrawer open onClose={onClose} title="测试">
                <div>内容</div>
            </MobileDrawer>,
        )
        const body = document.querySelector('.ant-drawer-body') as HTMLElement
        // 不加该约束时：wrapper 被 maxHeight 限高，但 body（auto 链）不收缩，
        // 溢出部分由 antd 的 .ant-drawer-section（overflow:auto）滚动——把手在其内部，会随内容滚走
        expect(body.style.maxHeight).toBe('85dvh')
        const wrapper = document.querySelector('.ant-drawer-content-wrapper') as HTMLElement
        expect(wrapper.style.maxHeight).toBe('85dvh')
    })
})
