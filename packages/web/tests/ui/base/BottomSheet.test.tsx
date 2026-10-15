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

/**
 * 底部 sheet 的行为契约（旧底部抽屉的 591 行不变量测试整体移植过来，语义一条不丢）：
 * 先通知后动画的关闭时序、两拍否决检测与沉降、连点单链、手势速度继承、哨兵栈
 * （推/拦截/否决后重臂/滑出窗口内仍拦截/嵌套 LIFO）、内容区收缩链、层号分层。
 *
 * jsdom 测不出的（真机验收项，见 .scratch/bottom-sheet/spec.md）：跟手拖拽的实际手感、
 * 遮罩随位移的连续变暗、进离场动效观感、iOS/Android 的安全区与返回手势。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useState } from 'react'
import type { AnimationPlaybackControls, MotionValue } from 'motion/react'
import { BottomSheet } from '@/ui/base/interactive/bottom-sheet/BottomSheet'
import { sheetClass } from '@/ui/base/layout/sheetSurface'
import { __resetHistoryGuardForTest } from '@/core/lib/drawerHistoryGuard'
import { __resetBodyScrollLockForTest } from '@/ui/base/interactive/bodyScrollLock'

// i18n 只透传 key（面板可访问名走 t('common.panel')）
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

// 记录 animate 调用（target/options），供「沉降回原位」「滑出目标」「速度继承」断言。
// vi.hoisted 保证变量可被提升到文件顶部的 vi.mock 工厂引用
const animateCalls = vi.hoisted(() => [] as Array<{ target: number; options?: unknown }>)
/** prefers-reduced-motion 开关：真实取值来自 matchMedia，jsdom 下直接桩掉以稳住用例 */
const motionFlags = vi.hoisted(() => ({ reduced: false }))

/** 记录哨兵 push 顺序（guardId）。构造「手势返回」用例要用——Chrome 语义下 popstate 的
 *  `event.state` 是**目的** entry 的 state（落到哪条），不是被消费那条；嵌套用例必须给出
 *  真实的落点，否则等同于「退到路由层」会被判成整栈收起 */
function trackGuardPushes(): number[] {
    // 先还原残留桩：vi.spyOn 对已桩化的方法返回同一 spy，再 mockImplementation 会让它调用
    // 自己（original 捕获的就是它）→ 栈溢出。文件无全局 restoreAllMocks，多条用例都用它
    vi.restoreAllMocks()
    const pushed: number[] = []
    const original = window.history.pushState.bind(window.history)
    vi.spyOn(window.history, 'pushState').mockImplementation(
        (state: { guardId?: number } | null, _title: string, url?: string | URL | null) => {
            const id = state?.guardId
            if (typeof id === 'number') pushed.push(id)
            original(state, url ?? window.location.href)
        },
    )
    return pushed
}

// spring 积分器在 jsdom 的 rAF 时间戳下发散（animate 0→400 实测冲到 751px 且不 resolve），
// 这里把 animate 换成「延迟 50ms 跳到目标并 resolve」的可控桩：保持「动画先于卸载」的
// 时序语义，落定确定可断言
vi.mock('motion/react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('motion/react')>()
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
    return { ...actual, animate: animateStub, useReducedMotion: () => motionFlags.reduced }
})

/** jsdom 量不到布局：强制 sheet 高度，让进离场走「屏内 → 滑出」分支 */
const SURFACE_H = 400
const EXTENSION = 160
/** 可见高（盒高 − 屏下延伸段） */
const VISIBLE_H = SURFACE_H - EXTENSION
/** 滑出目标 = 可见高 + CLOSED_GAP(40) */
const CLOSED_TARGET = VISIBLE_H + 40
/** 长内容档：可见高 1040 > peek 可见高（jsdom 视口 768 × 0.45 = 345.6）→ 两档分离 */
const LONG_SURFACE_H = 1200
const LONG_VISIBLE_H = LONG_SURFACE_H - EXTENSION
const PEEK_Y = LONG_VISIBLE_H - 0.45 * window.innerHeight

const surface = () => document.querySelector('[data-testid="bottom-sheet-surface"]') as HTMLElement | null
/** 当前位移：transform 为 none 即 0（顶档） */
const offsetY = () => {
    const matched = surface()?.style.transform.match(/translateY\(([-\d.]+)px\)/)
    return matched ? Number(matched[1]) : 0
}
/** 内容区（header 之后的第一个 child；末尾的 sr-only 播报不在其中） */
const bodyEl = () => surface()!.children[1] as HTMLElement
const grabberEl = () => surface()!.querySelector('[data-grabber]') as HTMLElement | null

function forceHeight(el: HTMLElement | null, value = SURFACE_H) {
    Object.defineProperty(el, 'offsetHeight', { value, configurable: true })
}

/** 进场那一刻（首次 commit 的 layout effect）就量高度，晚于 render 的 forceHeight 来不及——
 *  量到 0 时 height motion value 就停在 0，遮罩恒为 0、位移判定全退化。
 *  任何断言依赖「实测高度」的用例都必须在 render 前挂上，用完还原。 */
function forceOffsetHeightOnPrototype(value = SURFACE_H) {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => value })
    return () => {
        if (original) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original)
    }
}

/** 受控宿主：veto=true 时拦住关闭（复现执行中的操作菜单传 noop onClose 的场景） */
function Host({ veto = false, onClose, children, peek = true, showClose = false }: { veto?: boolean; onClose?: () => void; children?: React.ReactNode; peek?: boolean; showClose?: boolean }) {
    const [open, setOpen] = useState(true)
    return (
        <BottomSheet
            open={open}
            title="测试"
            peek={peek}
            showClose={showClose}
            onClose={() => {
                onClose?.()
                if (!veto) setOpen(false)
            }}
        >
            {children ?? <div>内容</div>}
        </BottomSheet>
    )
}

/** 等进场弹入落定（y 回到 0）；否则关闭会被判成「已出屏」直卸载。
 *  motion 把 0 位移写成了 transform: none（缺省值不产出 translateY） */
const waitSettled = () =>
    waitFor(() => {
        expect(['none', 'translateY(0px)']).toContain(surface()?.style.transform)
    })

/** 合成指针事件：jsdom 的 PointerEvent 不完整，手工补字段（React 读原生事件属性，故可行） */
function pointerEvent(type: string, init: { clientY: number; timeStamp: number; pointerId?: number }): Event {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.assign(event, {
        clientY: init.clientY,
        pointerId: init.pointerId ?? 1,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        buttons: 1,
    })
    Object.defineProperty(event, 'timeStamp', { value: init.timeStamp })
    return event
}

/** 合成触摸事件：jsdom 没有 TouchEvent，手工补 touches（组件读 event.touches[0] 与 timeStamp） */
function touchEvent(type: string, init: { clientX: number; clientY: number; timeStamp: number }, composed = false): Event {
    const event = new Event(type, { bubbles: true, cancelable: true, composed })
    Object.assign(event, { touches: [{ clientX: init.clientX, clientY: init.clientY }] })
    Object.defineProperty(event, 'timeStamp', { value: init.timeStamp })
    return event
}

/** 内容区触摸序列：touchstart → 若干 touchmove（组件按首帧 move 定模式并起手）→ touchend */
function touchStart(el: HTMLElement, clientY: number, timeStamp: number) {
    el.dispatchEvent(touchEvent('touchstart', { clientX: 100, clientY, timeStamp }))
}

function touch(el: HTMLElement, clientY: number, timeStamp: number) {
    el.dispatchEvent(touchEvent('touchmove', { clientX: 100, clientY, timeStamp }))
}

function touchEnd(el: HTMLElement, clientY: number, timeStamp: number) {
    el.dispatchEvent(touchEvent('touchend', { clientX: 100, clientY, timeStamp }))
}

/** 带横坐标的内容区触摸，返回「是否被 preventDefault」。横向用例要真的横向位移——
 *  横向滚动本身原生行为 jsdom 测不了，但「谁吞了这个手势」是 JS 侧判据，测得准 */
function touchAt(el: HTMLElement, type: string, clientX: number, clientY: number, timeStamp: number) {
    const event = touchEvent(type, { clientX, clientY, timeStamp })
    el.dispatchEvent(event)
    return event.defaultPrevented
}

/** 拖拽序列：header 按下 → header 上跟手移动 → 释放。
 *  move/up 打在 header 上而不是 window：Radix 的「指针在外部抬起」也会判 dismiss，
 *  而 window 不是 Node，会被当成「外部」→ 每次拖拽都额外关一次 sheet。
 *  releaseLag 是释放相对末次采样的间隔：velocityOf 只看最近 80ms、且停顿超 60ms 即掉动量
 *  （「慢而稳的释放落回原处」），需要速度的用例要贴着采样点释放，不需要的用例故意拖到停 */
function drag(steps: Array<{ y: number; t: number }>, releaseLag = 20) {
    const header = surface()!.querySelector('div') as HTMLElement
    header.dispatchEvent(pointerEvent('pointerdown', { clientY: steps[0].y, timeStamp: steps[0].t }))
    for (const step of steps.slice(1)) {
        header.dispatchEvent(pointerEvent('pointermove', { clientY: step.y, timeStamp: step.t }))
    }
    const last = steps[steps.length - 1]
    header.dispatchEvent(pointerEvent('pointerup', { clientY: last.y, timeStamp: last.t + releaseLag }))
}

describe('BottomSheet', () => {
    beforeEach(() => {
        __resetHistoryGuardForTest()
        __resetBodyScrollLockForTest()
        animateCalls.length = 0
    })

    // vitest 未开 globals，须显式 cleanup：portal 跨用例累积会让 querySelector 抓到上一用例的 sheet
    afterEach(() => {
        cleanup()
        motionFlags.reduced = false
    })

    it('渲染 / open 切换 / 卸载均不抛异常', () => {
        const onClose = vi.fn()
        const { rerender, unmount } = render(<BottomSheet open onClose={onClose} title="测试" />)

        rerender(<BottomSheet open={false} onClose={onClose} title="测试" />)
        rerender(<BottomSheet open onClose={onClose} title="测试" />)
        unmount()

        expect(onClose).not.toHaveBeenCalled()
    })

    it('open=false 时不推哨兵（不干扰路由层 history）', () => {
        const before = window.history.state
        render(<BottomSheet open={false} onClose={vi.fn()} title="测试" />)
        expect(window.history.state).toBe(before)
    })

    it('open 时推哨兵；手势返回立即调 onClose（先通知后动画，不等动画）', async () => {
        const onClose = vi.fn()
        render(<BottomSheet open onClose={onClose} title="测试" />)
        expect(window.history.state).toMatchObject({ mobiHistoryGuard: true })

        window.dispatchEvent(new PopStateEvent('popstate'))
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    })

    it('进场：首帧即置于屏外（位移取初值 4000，远在屏下），弹入动画目标 0', async () => {
        render(<BottomSheet open onClose={vi.fn()} title="测试" />)
        const el = surface()!
        expect(el).toBeTruthy()
        // 首帧不得出现在屏内：位移量初值远在屏下，随后由实测高度校正到「刚出屏」位置
        expect(el.style.transform).toBe('translateY(4000px)')
        // 弹入目标 0（而非退化成 0→0 的「无动画直出」）。
        // 起跳延迟至内容收敛（scrollHeight 稳定 + 无 pending 标记，见 waitForContentSettle），
        // 断言须等它真正起跳
        await waitFor(() => expect(animateCalls.some((call) => call.target === 0)).toBe(true))
    })

    it('收敛等待期内点外部不关闭（sheet 尚未露过面），起跳后恢复', async () => {
        const onClose = vi.fn()
        render(<Host onClose={onClose} />)
        const outsideDown = () => {
            const event = new Event('pointerdown', { bubbles: true, cancelable: true })
            document.dispatchEvent(event)
        }
        // 等待收敛期间 sheet 还在屏下、遮罩全透明：点外部（含再点触发钮）不得关掉
        // 一个用户从未见过的面板
        outsideDown()
        expect(onClose).not.toHaveBeenCalled()

        await waitSettled()
        outsideDown()
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('收敛等待期内滚动展开被忽略，起跳落初始档后照常生效', async () => {
        const restore = forceOffsetHeightOnPrototype(LONG_SURFACE_H)
        try {
            render(<Host />)
            // 等待收敛期间滚轮下滚 = 展开意图：此刻 sheet 在屏下，按估计高展开随后会被
            // startEnter 拽回屏下重放（「弹起→消失→再弹出」换个入口），必须忽略
            fireEvent.wheel(bodyEl(), { deltaY: 10 })

            // 起跳落初始档 peek（长内容 peekY > 0），期间没有任何到 top（0）的动画
            await waitFor(() => expect(offsetY()).toBeCloseTo(PEEK_Y, 1))
            expect(animateCalls.some((call) => call.target === 0)).toBe(false)

            // 起跳后滚动展开照常生效
            fireEvent.wheel(bodyEl(), { deltaY: 10 })
            await waitFor(() => expect(animateCalls.some((call) => call.target === 0)).toBe(true))
        } finally {
            restore()
        }
    })

    it('关闭：滑出目标 = 实测可见高 + CLOSED_GAP，落定后卸载', async () => {
        const onClose = vi.fn()
        const { rerender } = render(<BottomSheet open onClose={onClose} title="测试" />)
        forceHeight(surface())
        await waitSettled()

        rerender(<BottomSheet open={false} onClose={onClose} title="测试" />)
        await waitFor(() => expect(animateCalls.some((call) => call.target === CLOSED_TARGET)).toBe(true))
        // 落定后卸载（portal 里不再有 sheet）
        await waitFor(() => expect(surface()).toBeNull())
        // 父直调路径不经 onClose
        expect(onClose).not.toHaveBeenCalled()
    })

    it('否决式 onClose（open 保持 true）：sheet 沉降回原位而非卡在屏外', async () => {
        const onClose = vi.fn()
        render(<Host veto onClose={onClose} />)
        forceHeight(surface())
        await waitSettled()
        animateCalls.length = 0

        window.dispatchEvent(new PopStateEvent('popstate'))
        expect(onClose).toHaveBeenCalledTimes(1)

        // 否决检测（首拍 setTimeout 0 后进 100ms 宽限）触发沉降：目标 0 而非滑出目标
        await waitFor(() => expect(animateCalls.some((call) => call.target === 0)).toBe(true))
        expect(animateCalls.some((call) => call.target === CLOSED_TARGET)).toBe(false)
        expect(surface()).not.toBeNull()
    })

    it('连点关闭：宽限窗口内只保留最后一条否决检测链（单次沉降）', async () => {
        const onClose = vi.fn()
        render(<Host veto onClose={onClose} />)
        forceHeight(surface())
        await waitSettled()
        animateCalls.length = 0

        // 同一宽限窗口内两次关闭请求（连按返回 / 连点遮罩语义等价；此处用 Esc 走 Radix
        // 的关闭意图，避免依赖哨兵栈：哨兵在首次返回时已被消费，重臂要等否决判定）
        fireEvent.keyDown(document, { key: 'Escape' })
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(onClose).toHaveBeenCalledTimes(2)

        await waitFor(() => expect(animateCalls.some((call) => call.target === 0)).toBe(true))
        await new Promise((resolve) => setTimeout(resolve, 250))
        expect(animateCalls.filter((call) => call.target === 0)).toHaveLength(1)
        expect(animateCalls.some((call) => call.target === CLOSED_TARGET)).toBe(false)
    })

    it('快速下甩：走统一关闭路径，释放速度传到滑出动画（动量连续）', async () => {
        const onClose = vi.fn()
        render(<Host onClose={onClose} />)
        forceHeight(surface())
        await waitSettled()
        animateCalls.length = 0

        // 最近 80ms 内两点：50ms 走 50px → 1000px/s（> 500 阈值 → 关闭）；
        // 位移 200px < 可见高 240 → 仍在屏内，走滑出动画而非直卸载
        drag([
            { y: 100, t: 100 },
            { y: 150, t: 150 },
            { y: 200, t: 200 },
        ])

        expect(onClose).toHaveBeenCalledTimes(1)
        await waitFor(() => {
            const closeCall = animateCalls.find((call) => call.target === CLOSED_TARGET)
            expect(closeCall).toBeTruthy()
            expect((closeCall?.options as { velocity?: number } | undefined)?.velocity).toBe(1000)
        })
    })

    it('慢速小幅下拖：沉降回原位，不通知 onClose', async () => {
        const onClose = vi.fn()
        render(<Host onClose={onClose} />)
        forceHeight(surface())
        await waitSettled()
        animateCalls.length = 0

        // 位移 30px << 可见高/3(80)，且松手前停顿（释放晚 80ms > 60ms 窗口）→ 速度归零 → 回落
        drag(
            [
                { y: 100, t: 100 },
                { y: 130, t: 120 },
            ],
            80,
        )

        expect(onClose).not.toHaveBeenCalled()
        await waitFor(() => expect(animateCalls.some((call) => call.target === 0)).toBe(true))
        expect(animateCalls.some((call) => call.target === CLOSED_TARGET)).toBe(false)
    })

    it('遮罩强度随位移连续：拖拽起步无亮度台阶', async () => {
        const restore = forceOffsetHeightOnPrototype()
        try {
            render(<Host />)
            await waitSettled()

            const header = surface()!.querySelector('div') as HTMLElement
            header.dispatchEvent(pointerEvent('pointerdown', { clientY: 100, timeStamp: 100 }))
            header.dispatchEvent(pointerEvent('pointermove', { clientY: 110, timeStamp: 120 }))

            // 位移 10px / 滑出行程 → 线性斜坡在起点连续。照搬上游「最小停靠点内快速降到
            // LOW_DIM」的分段写法会把起点压成台阶：首帧即落到 0.78 一档（实测 0.75 附近）
            const overlay = document.querySelector('[data-testid="bottom-sheet-overlay"]') as HTMLElement
            await waitFor(() => expect(surface()?.style.transform).toBe('translateY(10px)'))
            expect(Number(overlay.style.opacity)).toBeCloseTo(1 - 10 / CLOSED_TARGET, 2)
        } finally {
            restore()
        }
    })

    it('reduced-motion：位移直接跳（不跑动画），进离场仍按统一路径收口', async () => {
        motionFlags.reduced = true
        const onClose = vi.fn()
        const { rerender } = render(<BottomSheet open onClose={onClose} title="测试" />)
        forceHeight(surface())

        // 进场即就位（jump），不产生 4000 → 0 的位移弹入
        await waitFor(() => expect(['none', 'translateY(0px)']).toContain(surface()?.style.transform))
        expect(animateCalls.some((call) => call.target === 0)).toBe(false)

        rerender(<BottomSheet open={false} onClose={onClose} title="测试" />)
        // 离场直接出屏并卸载，不跑滑出动画
        await waitFor(() => expect(surface()).toBeNull())
        expect(animateCalls.some((call) => call.target === CLOSED_TARGET)).toBe(false)
    })

    it('拖拽已把 sheet 甩到屏外时的关闭：直接卸载，不再多跑一次滑出', async () => {
        const onClose = vi.fn()
        render(<Host onClose={onClose} />)
        forceHeight(surface())
        await waitSettled()

        // 甩到可见高（240）之外，父组件随后才翻转 open
        drag([
            { y: 100, t: 100 },
            { y: 200, t: 140 },
            { y: 400, t: 180 },
        ])

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
        await waitFor(() => expect(surface()).toBeNull())
    })

    it('滑出动画窗口内哨兵仍存活：手势返回被本 sheet 拦截（onClose 幂等再调）', async () => {
        const onClose = vi.fn()
        const { rerender } = render(<BottomSheet open onClose={onClose} title="测试" />)
        forceHeight(surface())
        await waitSettled()

        rerender(<BottomSheet open={false} onClose={onClose} title="测试" />)
        expect(surface()?.style.transform).not.toBe(`translateY(${CLOSED_TARGET}px)`) // 滑出未落定
        window.dispatchEvent(new PopStateEvent('popstate'))

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    })

    it('否决后哨兵重臂：第二次手势返回仍关闭 sheet 而非穿透路由', async () => {
        const onClose = vi.fn()
        render(<Host veto onClose={onClose} />)
        forceHeight(surface())
        await waitSettled()

        window.dispatchEvent(new PopStateEvent('popstate'))
        await waitFor(() => expect(animateCalls.some((call) => call.target === 0)).toBe(true))
        // 重臂：guardId 递增（首推 1 → 重臂 2）
        await waitFor(() => expect(window.history.state).toMatchObject({ mobiHistoryGuard: true, guardId: 2 }))

        window.dispatchEvent(new PopStateEvent('popstate'))
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2))
    })

    it('父组件延迟 setOpen(false)（落在宽限窗口内）不误判否决：只有滑出、没有沉降', async () => {
        const onClose = vi.fn()
        function DelayedHost() {
            const [open, setOpen] = useState(true)
            return (
                <BottomSheet
                    open={open}
                    title="测试"
                    onClose={() => {
                        onClose()
                        setTimeout(() => setOpen(false), 50)
                    }}
                >
                    <div>内容</div>
                </BottomSheet>
            )
        }
        render(<DelayedHost />)
        forceHeight(surface())
        await waitSettled()
        animateCalls.length = 0

        window.dispatchEvent(new PopStateEvent('popstate'))
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
        animateCalls.length = 0

        await waitFor(() => expect(animateCalls.some((call) => call.target === CLOSED_TARGET)).toBe(true))
        expect(animateCalls.some((call) => call.target === 0)).toBe(false)
    })

    it('嵌套 sheet：子层 z-index 高于父层，返回手势只关子级（哨兵栈 LIFO）', async () => {
        const parentClose = vi.fn()
        const childClose = vi.fn()
        const pushed = trackGuardPushes()
        render(
            <Host onClose={parentClose}>
                <Host onClose={childClose} />
            </Host>,
        )
        const sheets = document.querySelectorAll('[data-testid="bottom-sheet-surface"]')
        const overlays = document.querySelectorAll('[data-testid="bottom-sheet-overlay"]')
        expect(sheets).toHaveLength(2)
        expect(overlays).toHaveLength(2)
        // 推哨兵顺序 = 后入先出序：父层先推（React passive effect 自顶向下），子层压顶
        expect(pushed).toHaveLength(2)
        const z = (el: Element, name: string) => Number(getComputedStyle(el as HTMLElement).getPropertyValue(name))
        // 子层必须压住父层：父层 sheet(z-top) < 子层遮罩(z) < 子层 sheet(z-top)
        expect(z(sheets[1], '--sheet-z-top')).toBeGreaterThan(z(sheets[0], '--sheet-z-top'))
        expect(z(overlays[1], '--sheet-z')).toBeGreaterThan(z(sheets[0], '--sheet-z-top'))

        // 手势返回落在父层哨兵上（Chrome 语义：event.state 是目的 entry 的 state）→ 只关子级
        window.dispatchEvent(new PopStateEvent('popstate', { state: { mobiHistoryGuard: true, guardId: pushed[0] } }))
        await waitFor(() => expect(childClose).toHaveBeenCalled())
        expect(parentClose).not.toHaveBeenCalled()

        // 第二次返回（真机诉求：二级与一级各由一个返回关掉，而不是第二次直接退出应用）：
        // 落点已到路由层 → 按落点整段对齐收起剩下的一级，且不再补推哨兵
        window.dispatchEvent(new PopStateEvent('popstate'))
        await waitFor(() => expect(parentClose).toHaveBeenCalled())
        expect(pushed).toHaveLength(2)
    })

    it('Esc 走统一关闭路径（Radix 语义 + 可被否决）', async () => {
        const onClose = vi.fn()
        render(<Host onClose={onClose} />)
        forceHeight(surface())
        await waitSettled()

        fireEvent.keyDown(document, { key: 'Escape' })
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    })

    it('关闭按钮走壳（SheetClose），点击触发 onClose', async () => {
        const onClose = vi.fn()
        render(<Host onClose={onClose} showClose />)
        forceHeight(surface())
        await waitSettled()

        const close = screen.getByRole('button', { name: 'common.close' })
        expect(close.className).toContain(sheetClass.iconBtn)
        fireEvent.click(close)
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    })

    it('无 title 时仍渲染可访问名（视觉隐藏的 Title），有 title 时渲染标题文本', () => {
        const { unmount } = render(<BottomSheet open onClose={vi.fn()} />)
        // 面板名回落到 i18n 的 common.panel（Radix 要求 Content 内存在 Title 元素）
        expect(document.body.textContent).toContain('common.panel')
        unmount()

        render(<BottomSheet open onClose={vi.fn()} title="标题文本" />)
        expect(document.body.textContent).toContain('标题文本')
    })

    it('矮面板（内容不超 peek 档）：两档重合，进场即全开、把手不做开关', async () => {
        render(<Host />)
        forceHeight(surface())
        await waitSettled()

        expect(offsetY()).toBe(0)
        // 单档不锁滚：没有「下面还有内容」这回事，锁了就成了「长菜单要拉一下才能滚」
        expect(surface()!.hasAttribute('data-scroll-locked')).toBe(false)
        // 两档同值：把手保持纯视觉（div），不做 aria-expanded 的空转开关
        expect(grabberEl()).toBeNull()
    })

    it('长内容：初始停在 peek 档（先露一截），把手是可点的展开开关', async () => {
        const restore = forceOffsetHeightOnPrototype(LONG_SURFACE_H)
        try {
            render(<Host />)
            // 等弹入落定（首帧把 y 甩到 1080 屏下位，落定才是 peek 位）
            await waitFor(() => expect(offsetY()).toBeCloseTo(PEEK_Y, 1))

            expect(offsetY()).toBeCloseTo(PEEK_Y, 1)
            // peek 档下内容区不滚（CSS 靠 data-scroll-locked 判定）
            expect(surface()!.hasAttribute('data-scroll-locked')).toBe(true)
            const grabber = grabberEl()!
            expect(grabber.tagName).toBe('BUTTON')
            expect(grabber.getAttribute('aria-expanded')).toBe('false')
        } finally {
            restore()
        }
    })

    it('peek={false}：长内容也打开即全开位（退化成单档），把手不做开关', async () => {
        const restore = forceOffsetHeightOnPrototype(LONG_SURFACE_H)
        try {
            render(<Host peek={false} />)
            await waitSettled()

            // 内容远超 peek 可见高，但关掉 peek 后进场直接落在顶档（y=0）
            expect(offsetY()).toBe(0)
            expect(surface()!.hasAttribute('data-scroll-locked')).toBe(false)
            // 单档路径：把手保持纯视觉（div），不做 aria-expanded 的空转开关
            expect(grabberEl()).toBeNull()
        } finally {
            restore()
        }
    })

    it('peek 档上推：展开到顶档（立刻解锁滚动）+ 播报档位', async () => {
        const restore = forceOffsetHeightOnPrototype(LONG_SURFACE_H)
        try {
            render(<Host />)
            await waitFor(() => expect(offsetY()).toBeGreaterThan(0))

            // 从 peek 位拉到顶档（位移 -PEEK_Y），快上推
            const header = surface()!.querySelector('div') as HTMLElement
            const start = 500
            header.dispatchEvent(pointerEvent('pointerdown', { clientY: start, timeStamp: 100 }))
            header.dispatchEvent(
                pointerEvent('pointermove', { clientY: start - Math.round(PEEK_Y), timeStamp: 150 }),
            )
            header.dispatchEvent(pointerEvent('pointerup', { clientY: start - Math.round(PEEK_Y), timeStamp: 170 }))

            await waitFor(() => expect(surface()!.hasAttribute('data-scroll-locked')).toBe(false))
            await waitFor(() => expect(offsetY()).toBeLessThan(PEEK_Y / 2))
            expect(grabberEl()!.getAttribute('aria-expanded')).toBe('true')
        } finally {
            restore()
        }
    })

    it('peek 档在内容区上推：同样展开到顶档（锁滚档内容区滚不动，判据不能只看 scrollTop）', async () => {
        const restore = forceOffsetHeightOnPrototype(LONG_SURFACE_H)
        try {
            render(<Host />)
            await waitFor(() => expect(offsetY()).toBeCloseTo(PEEK_Y, 1))
            expect(surface()!.hasAttribute('data-scroll-locked')).toBe(true)

            // 内容区「比可见区高」——锁滚档下这不代表内容能滚（CSS 已把纵向锁死）
            const body = bodyEl()
            Object.defineProperty(body, 'scrollHeight', { value: 900, configurable: true })
            Object.defineProperty(body, 'clientHeight', { value: 300, configurable: true })

            // 触摸从内容区（不是 header 抓手）起手。真机来源：工具详情的 diff / bash 输出横竖
            // 都滚不动——上推被判成「交给浏览器滚」，而锁滚档浏览器也动不了，整片区域成了死区。
            // 首帧 move 只用于定模式（beginDrag 落在该点，位移为 0），必须再来一次才真的拖
            touchStart(body, 700, 100)
            touch(body, 690, 110)
            touch(body, 20, 150)
            touchEnd(body, 20, 170)

            await waitFor(() => expect(surface()!.hasAttribute('data-scroll-locked')).toBe(false))
            await waitFor(() => expect(offsetY()).toBeLessThan(PEEK_Y / 2))
        } finally {
            restore()
        }
    })

    it('横向滑动前的手指抖动不把整段手势判给 sheet（判给 sheet 就会 preventDefault 掉 diff 的横向滚动）', async () => {
        render(<Host />)
        await waitSettled()
        const body = bodyEl()

        touchAt(body, 'touchstart', 100, 700, 100)
        // 真机落点带 1~3px 抖动，首帧往往纵向略占优：位移不足阈值就不表态
        expect(touchAt(body, 'touchmove', 102, 697, 110)).toBe(false)
        // 之后是纯横向滑动：必须留给浏览器（不该被 preventDefault）
        expect(touchAt(body, 'touchmove', 200, 697, 130)).toBe(false)
        expect(touchAt(body, 'touchmove', 300, 698, 150)).toBe(false)
        touchAt(body, 'touchend', 300, 698, 160)

        // sheet 全程未被拖动（判给 sheet 会带 data-dragging 并改写 transform）
        expect(surface()!.hasAttribute('data-dragging')).toBe(false)
        expect(offsetY()).toBe(0)
    })

    it('落点在 shadow DOM 里的滚动区上：手势同样归它（可滚性判据要穿透 shadow 边界）', async () => {
        const restore = forceOffsetHeightOnPrototype(SURFACE_H)
        try {
            render(<Host><div data-testid="host-el" /></Host>)
            await waitSettled()
            // 模拟 web component：真正的滚动区在自己 shadow root 里，浅 DOM 祖先链上看不见它
            const hostEl = screen.getByTestId('host-el')
            const scroller = document.createElement('div')
            scroller.style.overflowY = 'auto'
            hostEl.attachShadow({ mode: 'open' }).appendChild(scroller)
            Object.defineProperty(scroller, 'scrollHeight', { value: 600, configurable: true })
            Object.defineProperty(scroller, 'clientHeight', { value: 300, configurable: true })
            scroller.scrollTop = 100

            const deep = (type: string, y: number, t: number) => {
                const event = touchEvent(type, { clientX: 100, clientY: y, timeStamp: t }, true)
                scroller.dispatchEvent(event)
                return event.defaultPrevented
            }
            deep('touchstart', 400, 100)
            // 上滑且还有余量 → 交给浏览器滚它，不该被 sheet 抢走（旧实现只走 parentElement，必然判错）
            expect(deep('touchmove', 370, 120)).toBe(false)
            deep('touchend', 370, 140)

            expect(surface()!.hasAttribute('data-dragging')).toBe(false)
            expect(offsetY()).toBe(0)
        } finally {
            restore()
        }
    })

    it('落点在嵌套滚动区上：手势归它（可滚性要看落点所在的滚动链，不能只看内容区）', async () => {
        const restore = forceOffsetHeightOnPrototype(SURFACE_H)
        try {
            render(<Host><div data-testid="inner" /></Host>)
            await waitSettled()
            // 内层是「还能往下滚」的小滚动区（内容区自己装得下它 → 旧判据必然把手势判给 sheet）
            const inner = screen.getByTestId('inner')
            inner.style.overflowY = 'auto'
            Object.defineProperty(inner, 'scrollHeight', { value: 600, configurable: true })
            Object.defineProperty(inner, 'clientHeight', { value: 300, configurable: true })
            inner.scrollTop = 100

            touchAt(inner, 'touchstart', 100, 400, 100)
            // 上滑：内层还有余量 → 交给浏览器滚它，不该被 sheet 抢走
            expect(touchAt(inner, 'touchmove', 100, 370, 120)).toBe(false)
            touchAt(inner, 'touchend', 100, 370, 140)

            expect(surface()!.hasAttribute('data-dragging')).toBe(false)
            expect(offsetY()).toBe(0)
        } finally {
            restore()
        }
    })

    it('锁滚档（peek）：落点即使在内层滚动区上，纵向仍归 sheet（上推＝展开）', async () => {
        const restore = forceOffsetHeightOnPrototype(LONG_SURFACE_H)
        try {
            render(<Host><div data-testid="inner" /></Host>)
            await waitFor(() => expect(offsetY()).toBeCloseTo(PEEK_Y, 1))
            expect(surface()!.hasAttribute('data-scroll-locked')).toBe(true)
            const inner = screen.getByTestId('inner')
            inner.style.overflowY = 'auto'
            Object.defineProperty(inner, 'scrollHeight', { value: 600, configurable: true })
            Object.defineProperty(inner, 'clientHeight', { value: 300, configurable: true })
            inner.scrollTop = 100

            touchAt(inner, 'touchstart', 100, 700, 100)
            // 锁滚档内容区纵向锁死（CSS 也是 touch-action: pan-x），内层滚动区此刻也动不了
            expect(touchAt(inner, 'touchmove', 100, 660, 120)).toBe(true)
            touchAt(inner, 'touchmove', 100, 20, 150)
            touchAt(inner, 'touchend', 100, 20, 170)

            await waitFor(() => expect(offsetY()).toBeLessThan(PEEK_Y / 2))
        } finally {
            restore()
        }
    })

    it('展开档下拉过中点（慢速）：回落到 peek 档而不是关闭', async () => {
        const onClose = vi.fn()
        const restore = forceOffsetHeightOnPrototype(LONG_SURFACE_H)
        try {
            render(<Host onClose={onClose} />)
            await waitFor(() => expect(offsetY()).toBeGreaterThan(0))
            grabberEl()!.click() // 先到顶档
            await waitFor(() => expect(offsetY()).toBe(0))

            // 下拉 800px（> 顶档到 peek 档的一半 347）后停顿再松手 → 速度归零 → 按投影落 peek
            drag(
                [
                    { y: 200, t: 100 },
                    { y: 1000, t: 200 },
                ],
                80,
            )

            expect(onClose).not.toHaveBeenCalled()
            // 位移会先停在手指处（800），落档动画把它带回 peek 位
            await waitFor(() => expect(offsetY()).toBeCloseTo(PEEK_Y, 0))
            expect(offsetY()).toBeCloseTo(PEEK_Y, 0)
        } finally {
            restore()
        }
    })

    it('peek 档下拉：直接关闭（不会先落顶档）', async () => {
        const onClose = vi.fn()
        const restore = forceOffsetHeightOnPrototype(LONG_SURFACE_H)
        try {
            render(<Host onClose={onClose} />)
            await waitFor(() => expect(offsetY()).toBeGreaterThan(0))

            drag(
                [
                    { y: 200, t: 100 },
                    { y: 800, t: 200 },
                ],
                80,
            )

            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
            await waitFor(() => expect(surface()).toBeNull())
        } finally {
            restore()
        }
    })

    it('内容区滚轮：peek 档展开，顶档下滚不重复触发', async () => {
        const restore = forceOffsetHeightOnPrototype(LONG_SURFACE_H)
        try {
            render(<Host />)
            // 等到起跳落定 peek（等待期内 transform=4000 同样 > 0，不能当落定判据）
            await waitFor(() => expect(offsetY()).toBeCloseTo(PEEK_Y, 1))

            fireEvent.wheel(bodyEl(), { deltaY: 12 })
            await waitFor(() => expect(surface()!.hasAttribute('data-scroll-locked')).toBe(false))

            await waitFor(() => expect(offsetY()).toBe(0))
        } finally {
            restore()
        }
    })

    it('点把手：在顶档与 peek 档之间切换', async () => {
        const restore = forceOffsetHeightOnPrototype(LONG_SURFACE_H)
        try {
            render(<Host />)
            await waitFor(() => expect(offsetY()).toBeGreaterThan(0))

            grabberEl()!.click()
            await waitFor(() => expect(offsetY()).toBe(0))

            grabberEl()!.click()
            await waitFor(() => expect(offsetY()).toBeCloseTo(PEEK_Y, 0))
        } finally {
            restore()
        }
    })

    it('样式源不变量：内容自适应 + 上限、滚动收缩链、底部安全区、层号分层、居中三栏标题行', () => {
        // CSS modules 在 vitest 里不进 DOM（无 css: true），关键不变量读源码断言
        // （先例：tests/components/StatusDot.test.tsx）。
        // 两个文件：sheet 自己的定位/状态规则，与共享壳（面 + 头部 + 内容区滚动链）——
        // 后者的不变量对画板载体同样成立，故断言也要落在壳上，别只盯 sheet
        const css = readFileSync(join(process.cwd(), 'src/ui/base/interactive/bottom-sheet/bottom-sheet.module.css'), 'utf8')
        const shell = readFileSync(join(process.cwd(), 'src/ui/base/layout/sheetSurface.module.css'), 'utf8')
        // 高度：内容自适应（height:auto）+ 上限 = 调用方档位（--sheet-max-height，默认 85dvh）
        expect(css).toMatch(/\.sheet \{[^}]*height: auto;/)
        expect(css).toMatch(/max-height: calc\(var\(--sheet-max-height, 85dvh\) \+ var\(--sheet-extension\)\)/)
        // 内容区：唯一滚动区 + 解除 flex item 的「不收缩」（没有它长内容会撑爆 sheet 被裁）
        expect(shell).toMatch(/\.body \{[^}]*min-height: 0;/)
        expect(shell).toMatch(/\.body \{[^}]*overflow-y: auto;/)
        // 底部安全区：触控余量与 home indicator 取大者（与旧底部抽屉同档）
        expect(css).toMatch(/padding-bottom: calc\(var\(--sheet-extension\) \+ max\(24px, env\(safe-area-inset-bottom/)
        // 层号分层：z-index 不再写死 50/51，缺省回落也取自 --mobi-z-overlay（层号基线唯一来源）。
        // 定位在本地（壳只管遮罩视觉）——画板的 PC 遮罩是 absolute，两套定位住不进同一个类
        expect(css).toMatch(/\.mask \{[^}]*z-index: var\(--sheet-z, var\(--mobi-z-overlay\)\);/)
        expect(css).toMatch(/\.mask \{[^}]*position: fixed;/)
        expect(shell).toMatch(/\.mask \{[^}]*background: var\(--sheet-mask-bg, oklch\(16% 0 0 \/ 0\.34\)\)/)
        expect(css).toMatch(/z-index: var\(--sheet-z-top, calc\(var\(--mobi-z-overlay\) \+ 1\)\)/)
        // 面：形状语言只在壳里（贴底 = 上半圆角；悬浮矩形 = 四角），且取档引用不写死数值。
        // 档位取 panel（DESIGN.md：卡片/悬浮面板/菜单 = panel，surface 档是 Modal 的）
        expect(shell).toMatch(/\.surfaceBottom \{[^}]*border-radius: var\(--radius-panel\) var\(--radius-panel\) 0 0;/)
        expect(shell).toMatch(/\.surfaceFloating \{[^}]*border-radius: var\(--radius-panel\);/)
        // 标题行：三栏 grid（1fr 内容 1fr）——标题恒居中，extra/关闭按钮靠右
        expect(shell).toMatch(/grid-template-columns: 1fr minmax\(0, auto\) 1fr/)
        expect(shell).toMatch(/\.headText \{[^}]*grid-column: 2;/)
        expect(shell).toMatch(/\.headActions \{[^}]*grid-column: 3;/)
        // reduced-motion：CSS 侧的微过渡全部关掉（sheet 自身的位移由 JS 分支直接跳，见另一用例）
        expect(shell).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^}]*transition: none;/)
        // peek 档：纵向不滚、触摸只改档（靠 data-scroll-locked 命中，跨模块用 data 属性而非类名）；
        // 横向仍放给内容——写 none 会把 diff 这类嵌套滚动区一起锁死（真机「横竖都不能滚」）
        expect(css).toMatch(/\.sheet\[data-scroll-locked\] \[data-sheet-body\] \{[^}]*overflow: hidden;/)
        expect(css).toMatch(/\.sheet\[data-scroll-locked\] \[data-sheet-body\] \{[^}]*touch-action: pan-x;/)
        // 内容区两个方向都可滚（touch-action 在祖先上会限制整个子树，diff 的横向滚动曾被锁死）
        expect(shell).toMatch(/\.body \{[^}]*touch-action: pan-x pan-y;/)
    })
})
