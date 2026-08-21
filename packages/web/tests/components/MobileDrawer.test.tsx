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
import { useState } from 'react'
import type {
    AnimationPlaybackControls,
    HTMLMotionProps,
    MotionValue,
    PanInfo,
} from 'motion/react'
import { MobileDrawer } from '@/components/ui/MobileDrawer'
import { __resetHistoryGuardForTest } from '@/core/lib/drawerHistoryGuard'

// 记录 animate 调用参数（target / options），供「否决沉降回原位」「速度继承」断言。
// vi.hoisted 保证变量可被 vi.mock 工厂（提升到文件顶部）引用
const animateCalls = vi.hoisted(() => [] as Array<{ target: number; options?: unknown }>)

// motion 的 spring 积分器在 vitest jsdom 的 rAF 时间戳下会发散（实测 animate 0→400
// 在 300ms 冲到 751px 且永不 resolve；tween 正常）。既有 popstate 用例能过只因
// y 已在目标值、动画瞬时完成。半受控挂载的「滑出落定 → 卸载」依赖真实 spring 落定，
// 这里部分 mock 'motion/react'：其余导出原样，animate 替换为「延迟 50ms 后跳到目标
// 并 resolve」的可控桩——保持「动画先于卸载」的时序语义，断言确定性落定
vi.mock('motion/react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('motion/react')>()
    const { createElement, forwardRef } = await import('react')
    const animateStub = (
        value: MotionValue<number>,
        target: number,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _options?: unknown,
    ): AnimationPlaybackControls => {
        animateCalls.push({ target, options: _options })
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

    // motion.div 桩：真实 motion.div 原样渲染（样式 / drag props 全透传），仅把
    // onDragEnd 回调挂到 DOM 节点（__mobiDragEnd）上，供测试以合成 PanInfo 直接触发
    // handleDragEnd——jsdom 无法模拟真实 motion 拖拽序列，而拖拽跟手机制本身是
    // motion 的职责，不在本组件测试范围
    const MotionDivStub = forwardRef<HTMLDivElement, HTMLMotionProps<'div'>>(
        function MotionDivStub(props, ref) {
            const { onDragEnd, ...rest } = props
            return createElement(actual.motion.div, {
                ...rest,
                onDragEnd,
                ref: (node: HTMLDivElement | null) => {
                    if (typeof ref === 'function') ref(node)
                    else if (ref) ref.current = node
                    if (node) {
                        ;(node as HTMLDivElement & { __mobiDragEnd?: unknown }).__mobiDragEnd
                            = onDragEnd
                    }
                },
            })
        },
    )

    // motion 是 Proxy（spread 会丢方法），包一层把 div 指向桩、其余透传真实实现
    const motionStub = new Proxy(actual.motion, {
        get(target, key) {
            return key === 'div' ? MotionDivStub : Reflect.get(target, key)
        },
    })

    return { ...actual, animate: animateStub, motion: motionStub }
})

/** 受控宿主：模拟真实父组件——onClose 时翻转 open（触发关闭 effect 滑出）；
 *  veto=true 时拦住关闭（复现 MessageActionsDrawer loading 时传 noop onClose 的
 *  否决式消费场景：open 保持 true，关闭 effect 不会运行） */
function DrawerHost({ veto = false, onClose, children }: { veto?: boolean; onClose?: () => void; children?: React.ReactNode }) {
    const [open, setOpen] = useState(true)
    const handleClose = () => {
        onClose?.()
        if (!veto) setOpen(false)
    }
    return (
        <MobileDrawer open={open} onClose={handleClose} title="测试">
            {children ?? <div>内容</div>}
        </MobileDrawer>
    )
}

/** 以合成 PanInfo 直接触发 handleDragEnd（motion.div 桩挂出的 __mobiDragEnd） */
const triggerDragEnd = (offsetY: number, velocityY: number) => {
    const sheet = document.querySelector('[data-testid="mobile-drawer-sheet"]') as
        (HTMLElement & { __mobiDragEnd?: (e: never, info: PanInfo) => void }) | null
    expect(sheet?.__mobiDragEnd).toBeTypeOf('function')
    sheet!.__mobiDragEnd!(undefined as never, {
        point: { x: 0, y: offsetY },
        delta: { x: 0, y: offsetY },
        offset: { x: 0, y: offsetY },
        velocity: { x: 0, y: velocityY },
    })
}

/** 等打开弹入动画落定（sheet 回到屏内 y=0），后续关闭才不会被关闭 effect
 *  误判为「已出屏」而跳过滑出动画。注意起点是 translateY(innerHeight)（视口高），
 *  不能按具体高度断言——桩 50ms 后跳到 0，transform 离开屏外值即落定 */
const waitForOpenSettled = async () => {
    const sheet = document.querySelector('[data-testid="mobile-drawer-sheet"]') as HTMLElement
    await waitFor(() => {
        expect(sheet.style.transform).not.toBe(`translateY(${window.innerHeight}px)`)
    }, { timeout: 2000 })
}

describe('MobileDrawer', () => {
    beforeEach(() => {
        __resetHistoryGuardForTest()
        animateCalls.length = 0
    })

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

    it('open 时推 history 哨兵，手势返回（popstate）立即触发 onClose（先通知后动画），父组件翻转 open 后由关闭 effect 滑出', async () => {
        const onClose = vi.fn()
        render(<MobileDrawer open onClose={onClose} title="测试" />)
        // open 即应推入哨兵
        expect(window.history.state).toMatchObject({ mobiHistoryGuard: true })
        // 模拟移动端全屏手势返回
        window.dispatchEvent(new PopStateEvent('popstate'))
        // 手势返回统一走 closeWithAnimation：新时序下 onClose 立即被调（无动画等待）
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), { timeout: 2000 })
    })

    it('打开动画起点用视口高、不依赖 offsetHeight：effect 同步执行后 sheet 即被置于屏外（translateY(innerHeight)）', () => {
        const onClose = vi.fn()
        render(<MobileDrawer open onClose={onClose} title="测试" />)
        const sheet = document.querySelector('[data-testid="mobile-drawer-sheet"]') as HTMLElement
        expect(sheet).toBeTruthy()
        // CDP 实证：antd v6 panel 挂载/可测晚于打开动画 effect（首开 ref null、
        // 重开 hidden 态高度 0），读 offsetHeight 会退化 h=0 → animate(0→0) 瞬时
        // = 真机「弹出大概率无动画」。起点必须与测量时序解耦：
        // useLayoutEffect 同步 y.set(innerHeight)，motion.div 挂载时以该值渲染
        expect(sheet.style.transform).toBe(`translateY(${window.innerHeight}px)`)
        // animate 目标为 0（弹入屏内），而非退化的 0→0
        expect(animateCalls.some((c) => c.target === 0)).toBe(true)
    })

    it('否决式 onClose（loading 守卫拦下关闭、open 保持 true）时 sheet 沉降回原位而非卡在屏外', async () => {
        const onClose = vi.fn()
        // veto 宿主：onClose 被调但不翻转 open（复现 MessageActionsDrawer 的 loading 守卫）
        render(<DrawerHost veto onClose={onClose} />)
        // jsdom 下 offsetHeight 恒 0，强制给定高度让关闭路径走「滑出屏」目标 y=400
        const sheet = document.querySelector('[data-testid="mobile-drawer-sheet"]') as HTMLElement
        Object.defineProperty(sheet, 'offsetHeight', { value: 400 })
        await waitForOpenSettled()
        animateCalls.length = 0

        // 模拟点遮罩 / 手势返回路径触发关闭（popstate → closeWithAnimation()）
        window.dispatchEvent(new PopStateEvent('popstate'))

        // 先通知后动画：onClose 立即被调，但被宿主否决（open 保持 true）
        expect(onClose).toHaveBeenCalledTimes(1)

        // 否决检测（setTimeout 0，等 setState flush 后读 openRef）触发沉降：
        // animate 目标是 0（回原位）而非 400（滑出屏）——旧实现会滑出屏后卡死
        await waitFor(() => {
            expect(animateCalls.some((c) => c.target === 0)).toBe(true)
        }, { timeout: 2000 })
        expect(animateCalls.some((c) => c.target === 400)).toBe(false)

        // 沉降后：drawer 未卸载（仍 open）、sheet 未滑出屏
        const root = document.querySelector('.ant-drawer') as HTMLElement
        expect(root.className).toContain('ant-drawer-open')
        expect(sheet.style.transform).not.toBe('translateY(400px)')
    })

    it('手势关闭路径：释放速度经 pendingCloseVelocityRef 传到关闭 effect 的滑出动画（velocity 继承）', async () => {
        const onClose = vi.fn()
        render(<DrawerHost onClose={onClose} />)
        const sheet = document.querySelector('[data-testid="mobile-drawer-sheet"]') as HTMLElement
        Object.defineProperty(sheet, 'offsetHeight', { value: 400 })
        await waitForOpenSettled()
        animateCalls.length = 0

        // 拖拽过 1/3 高度（300 > 400/3）→ 'close' 分支；释放速度 800px/s 一并带出
        triggerDragEnd(300, 800)

        // 先通知后动画：onClose 立即被调，宿主翻转 open → 关闭 effect 接管滑出
        expect(onClose).toHaveBeenCalledTimes(1)

        // 关闭 effect 的 animate：目标 400（滑出屏）且 options.velocity 继承手势速度 800
        await waitFor(() => {
            const closeCall = animateCalls.find((c) => c.target === 400)
            expect(closeCall).toBeTruthy()
            expect((closeCall?.options as { velocity?: number } | undefined)?.velocity).toBe(800)
        }, { timeout: 2000 })

        // 滑出落定 → setMounted(false) → drawer 关闭（antd leave 只淡出 mask）
        await waitFor(() => {
            const r = document.querySelector('.ant-drawer') as HTMLElement | null
            expect(r?.className ?? '').not.toContain('ant-drawer-open')
        }, { timeout: 2000 })
    })

    it('父组件直调 open=false（不经 onClose）时滑出与 antd leave 并行启动——mask 淡出不滞后成残影', async () => {
        const onClose = vi.fn()
        const { rerender } = render(<MobileDrawer open onClose={onClose} title="测试" />)

        // jsdom 下 offsetHeight 恒 0，关闭 effect 会判为「已出屏」立即卸载；
        // 手动给定高度让关闭走「滑出」分支（滑出目标 y=h=400）
        const sheet = document.querySelector('[data-testid="mobile-drawer-sheet"]') as HTMLElement
        expect(sheet).toBeTruthy()
        Object.defineProperty(sheet, 'offsetHeight', { value: 400 })
        // 等打开弹入落定：否则 y 仍在屏外（translateY(innerHeight)），关闭 effect
        // 会判「已出屏」直接卸载、不走滑出分支
        await waitForOpenSettled()

        rerender(<MobileDrawer open={false} onClose={onClose} title="测试" />)

        // 并行时序：open=false 立即翻 mounted → antd leave 马上开始（open 类即刻移除，
        // mask 淡出与滑出同步——串行会有「sheet 走了 mask 再慢慢淡出」的残影）
        const root = document.querySelector('.ant-drawer') as HTMLElement
        expect(root).toBeTruthy()
        expect(root.className).not.toContain('ant-drawer-open')

        // 滑出动画仍在进行（50ms 桩未落定）：sheet 尚未出屏，随后落定到位
        expect(sheet.style.transform).not.toBe('translateY(400px)')
        await waitFor(() => {
            expect(sheet.style.transform).toBe('translateY(400px)')
        }, { timeout: 2000 })

        // 全程不经 onClose（父直调路径，非交互关闭）
        expect(onClose).not.toHaveBeenCalled()
    })

    it('滑出动画窗口内哨兵仍存活：手势返回被本 drawer 拦截（再触发 onClose）而非穿透到路由层', async () => {
        const onClose = vi.fn()
        const { rerender } = render(<MobileDrawer open onClose={onClose} title="测试" />)
        const sheet = document.querySelector('[data-testid="mobile-drawer-sheet"]') as HTMLElement
        Object.defineProperty(sheet, 'offsetHeight', { value: 400 })
        await waitForOpenSettled()
        animateCalls.length = 0

        // 父组件直调关闭：关闭 effect 立即翻 mounted=false（并行卸载），滑出动画
        //（50ms 桩）尚在途——此时手势返回
        rerender(<MobileDrawer open={false} onClose={onClose} title="测试" />)
        expect(sheet.style.transform).not.toBe('translateY(400px)') // 滑出未落定
        window.dispatchEvent(new PopStateEvent('popstate'))

        // 哨兵未随 mounted=false 被 dispose：popstate 消费哨兵 → closeWithAnimation
        // → onClose 被调（幂等，父组件已是 false）。旧实现绑 mounted，滑出起手即
        // dispose，popstate 落空 → onClose 不被调（真实浏览器上穿透退出 session detail）
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), { timeout: 2000 })
        // 关闭已接管（openRef=false），否决检测不应再沉降
        await waitFor(() => {
            expect(animateCalls.some((c) => c.target === 400)).toBe(true)
        }, { timeout: 2000 })
        expect(animateCalls.some((c) => c.target === 0)).toBe(false)
    })

    it('否决后哨兵重臂：沉降回原位时重推哨兵，第二次手势返回仍关闭 drawer 而非穿透路由', async () => {
        const onClose = vi.fn()
        render(<DrawerHost veto onClose={onClose} />)
        const sheet = document.querySelector('[data-testid="mobile-drawer-sheet"]') as HTMLElement
        Object.defineProperty(sheet, 'offsetHeight', { value: 400 })
        await waitForOpenSettled()
        animateCalls.length = 0

        // 第一次手势返回：哨兵被消费，但关闭被否决（open 保持 true）
        window.dispatchEvent(new PopStateEvent('popstate'))
        expect(onClose).toHaveBeenCalledTimes(1)
        // 否决检测触发沉降 + 重臂：guardId 递增（首推 1 → 重臂 2）
        await waitFor(() => {
            expect(animateCalls.some((c) => c.target === 0)).toBe(true)
        }, { timeout: 2000 })
        await waitFor(() => {
            expect(window.history.state).toMatchObject({ mobiHistoryGuard: true, guardId: 2 })
        }, { timeout: 2000 })

        // 第二次手势返回：消费重臂哨兵，仍关闭 drawer（onClose 第二次被调）。
        // 旧实现哨兵已被消费且未重推，popstate 落空 → 穿透到路由层
        window.dispatchEvent(new PopStateEvent('popstate'))
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2), { timeout: 2000 })
    })

    it('嵌套 drawer：手势返回只关子级不关父级（哨兵栈序 LIFO）', async () => {
        const parentClose = vi.fn()
        const childClose = vi.fn()
        // 子 drawer 渲染在父 children 内，同帧挂载——后推哨兵者在栈顶
        render(
            <DrawerHost onClose={parentClose}>
                <DrawerHost onClose={childClose} />
            </DrawerHost>,
        )
        expect(window.history.state).toMatchObject({ mobiHistoryGuard: true })

        // 模拟手势返回：popstate 应消费子级哨兵，只关子
        window.dispatchEvent(new PopStateEvent('popstate'))

        await waitFor(() => expect(childClose).toHaveBeenCalled(), { timeout: 2000 })
        expect(parentClose).not.toHaveBeenCalled()
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

    it('溢出收缩链不变量：sheet 用 flex:1+minHeight:0（禁 height:100%）、内容区补 minHeight:0——否则长内容撑爆 sheet 被裁而非出滚动', () => {
        const onClose = vi.fn()
        render(
            <MobileDrawer open onClose={onClose} title="测试">
                <div>内容</div>
            </MobileDrawer>,
        )
        const sheet = document.querySelector('[data-testid="mobile-drawer-sheet"]') as HTMLElement
        expect(sheet).toBeTruthy()
        // height:'100%' 在只有 maxHeight（height:auto）的 body 下按 CSS 规范退化为
        // auto——CDP 实测内容超限时 sheet 被撑到内容全高（2449px），溢出被 body
        // 的 overflow:hidden 直接裁掉 = 真机「内容多看不到、不滚动」
        expect(sheet.style.height).not.toBe('100%')
        expect(sheet.style.flex).toBe('1 1 0%')
        expect(sheet.style.minHeight).toBe('0px')
        // 内容区：flex item 默认 min-height:auto 不收缩，无 minHeight:0 时没有
        // 可滚空间（scrollHeight === clientHeight）
        const contentArea = sheet.querySelector(':scope > div:last-child') as HTMLElement
        expect(contentArea.style.minHeight).toBe('0px')
        expect(contentArea.style.overflow).toBe('auto')
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
