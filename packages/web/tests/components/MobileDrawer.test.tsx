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
import { render, cleanup, waitFor } from '@testing-library/react'
import type { AnimationPlaybackControls, MotionValue } from 'motion/react'
import { MobileDrawer } from '@/components/ui/MobileDrawer'
import { __resetHistoryGuardForTest } from '@/core/lib/drawerHistoryGuard'

// motion 的 spring 积分器在 vitest jsdom 的 rAF 时间戳下会发散（实测 animate 0→400
// 在 300ms 冲到 751px 且永不 resolve；tween 正常）。既有 popstate 用例能过只因
// y 已在目标值、动画瞬时完成。半受控挂载的「滑出落定 → 卸载」依赖真实 spring 落定，
// 这里部分 mock 'motion/react'：其余导出原样，animate 替换为「延迟 50ms 后跳到目标
// 并 resolve」的可控桩——保持「动画先于卸载」的时序语义，断言确定性落定
vi.mock('motion/react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('motion/react')>()
    const animateStub = (
        value: MotionValue<number>,
        target: number,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _options?: unknown,
    ): AnimationPlaybackControls => {
        const promise = new Promise<void>((resolve) => {
            setTimeout(() => {
                value.set(target)
                resolve()
            }, 50)
        })
        return {
            stop() {},
            then: (resolve, reject) => promise.then(resolve, reject),
        } as AnimationPlaybackControls
    }
    return { ...actual, animate: animateStub }
})

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

    it('open 时推 history 哨兵，手势返回（popstate）先滑出动画、落定后触发 onClose 关闭 drawer', async () => {
        const onClose = vi.fn()
        render(<MobileDrawer open onClose={onClose} title="测试" />)
        // open 即应推入哨兵
        expect(window.history.state).toMatchObject({ mobiHistoryGuard: true })
        // 模拟移动端全屏手势返回
        window.dispatchEvent(new PopStateEvent('popstate'))
        // 手势返回统一走 closeWithAnimation：先 spring 滑出屏，落定后才调 onClose（异步）
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), { timeout: 2000 })
    })

    it('父组件直调 open=false（不经 onClose）时 sheet 先滑出再卸载——动画优先于卸载', async () => {
        const onClose = vi.fn()
        const { rerender } = render(<MobileDrawer open onClose={onClose} title="测试" />)

        // jsdom 下 offsetHeight 恒 0，关闭 effect 会判为「已出屏」立即卸载；
        // 手动给定高度让关闭走「滑出再卸载」分支（滑出目标 y=h=400）
        const sheet = document.querySelector('[data-testid="mobile-drawer-sheet"]') as HTMLElement
        expect(sheet).toBeTruthy()
        Object.defineProperty(sheet, 'offsetHeight', { value: 400 })

        rerender(<MobileDrawer open={false} onClose={onClose} title="测试" />)

        // 滑出动画进行中（50ms 桩未落定）：mounted 仍 true，antd 未 leave——
        // drawer 仍带 ant-drawer-open 类、sheet 未出屏
        const root = document.querySelector('.ant-drawer') as HTMLElement
        expect(root).toBeTruthy()
        expect(root.className).toContain('ant-drawer-open')
        expect(sheet.style.transform).not.toBe('translateY(400px)')

        // 动画落定 → setMounted(false) → antd leave——antd Drawer 关闭不卸载 DOM
        //（默认 destroyOnClose=false），可见性信号是 open 类移除 + wrapper 转隐藏类
        await waitFor(() => {
            const r = document.querySelector('.ant-drawer') as HTMLElement | null
            expect(r?.className ?? '').not.toContain('ant-drawer-open')
            expect(
                document.querySelector('.ant-drawer-content-wrapper')?.className,
            ).toContain('ant-drawer-content-wrapper-hidden')
        }, { timeout: 2000 })

        // 滑出落定后 y 到位（sheet 出屏）
        expect(sheet.style.transform).toBe('translateY(400px)')

        // 全程不经 onClose（父直调路径，非交互关闭）
        expect(onClose).not.toHaveBeenCalled()
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

    it('section 顶部左右圆角 + overflow hidden（header/内容裁切到圆角内；antd v6 section = 旧 content）', () => {
        render(<MobileDrawer open onClose={vi.fn()} title="测试"><div>内容</div></MobileDrawer>)
        const section = document.querySelector('.ant-drawer-section') as HTMLElement
        expect(section).toBeTruthy()
        expect(section.style.borderTopLeftRadius).toBe('12px')
        expect(section.style.borderTopRightRadius).toBe('12px')
        expect(section.style.overflow).toBe('hidden')
    })

    it('标题恒居中：三栏 grid（1fr 内容 1fr），标题中栏、extra 右栏——空间不足时省略号截断而非重叠', () => {
        render(
            <MobileDrawer open onClose={vi.fn()} title="标题" extra={<span>右侧操作</span>}>
                <div>内容</div>
            </MobileDrawer>,
        )
        // 首个 span 是 TitleText（DragHandle 是 div）；TitleRow 即其父级 div（emotion css- 类）
        const title = document.querySelector('.ant-drawer-body span') as HTMLElement
        const row = title.closest('div') as HTMLElement
        const extra = row.querySelectorAll('span')[1] as HTMLElement
        expect(title).toBeTruthy()
        expect(extra).toBeTruthy()

        const titleStyle = getComputedStyle(title as HTMLElement)
        const extraStyle = getComputedStyle(extra as HTMLElement)
        // 三栏 grid：标题在中栏（grid-column 2）居中，extra 在右栏（grid-column 3）靠右；
        // 各占一栏天然不重叠——绝对定位方案下长标题会延伸到 extra 下方
        expect(titleStyle.gridColumn).toBe('2')
        expect(titleStyle.justifySelf).toBe('center')
        expect(titleStyle.overflow).toBe('hidden')
        expect(titleStyle.textOverflow).toBe('ellipsis')
        expect(extraStyle.gridColumn).toBe('3')
        expect(extraStyle.justifySelf).toBe('end')
        // 栅格模板（1fr minmax(0,auto) 1fr）保证左右两栏等分、标题几何居中
        //（jsdom 不解析逗号内空格，按整体串断言）
        const template = getComputedStyle(row as HTMLElement).gridTemplateColumns
        expect(template.startsWith('1fr')).toBe(true)
        expect(template).toContain('minmax(0')
        expect(template.endsWith('1fr')).toBe(true)
    })
})
