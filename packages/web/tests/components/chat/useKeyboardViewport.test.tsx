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

// useKeyboardViewport 行为锁定：
// - 基线棘轮修复（/code-review finding）——基线跟随环境变化必须可逆，否则桌面缩放/URL 栏
//   回落会永久假「键盘弹出」
// - 外部 store + selector（code-review 2026-10-31）——页级组件订布尔切片，键盘周期只重渲染
//   2 次
// - overlay 终值事件（2026-10-31 真机 CDP 实锤：Chromium 的 geometrychange/env 只在键盘
//   滑动动画结束后以终值集中触发）——store 在事件时刻（focusin 预测 / 终值校正 / focusout
//   收起）写**一次终值**，插值全由消费端 CSS transition 承担。曾经 rAF 逐帧写变量自补动画，
//   真机全页掉帧已废（2026-11-01：JS 逐帧回调 + React 逐帧通知 + resize 广播风暴全是徒增，
//   padding 逐帧 reflow 本来就省不掉）。故断言只锁终值即时性；jsdom 不跑 transition，插值
//   归浏览器
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import {
    useKeyboardViewportSelector,
    resetKeyboardViewportForTests,
    ensureKeyboardViewportWatchers,
    KB_INSET_CSS_VAR,
} from '@/features/chat/useKeyboardViewport'

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

/** jsdom 无 visualViewport：可变几何 + EventTarget 的假体，按需改属性后手动派发事件 */
function stubVisualViewport() {
    const target = new EventTarget()
    const vv = Object.assign(target, { offsetTop: 0, height: 800, width: 390 })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv })
    return vv
}

function fire(vv: EventTarget, type: 'resize' | 'scroll') {
    act(() => { vv.dispatchEvent(new Event(type)) })
}

/** overlay 模式假体：VirtualKeyboard API 开 overlay 时几何改源 geometrychange（vv 数学恒 0 不可用） */
function stubVirtualKeyboard() {
    const target = new EventTarget()
    const vk = Object.assign(target, {
        overlaysContent: true,
        boundingRect: { height: 0, width: 390, x: 0, y: 400 },
    })
    Object.defineProperty(navigator, 'virtualKeyboard', { configurable: true, value: vk })
    return vk
}

function fireGeometry(vk: EventTarget & { boundingRect: { height: number } }, height: number) {
    vk.boundingRect.height = height
    act(() => { vk.dispatchEvent(new Event('geometrychange')) })
}

/** 环境几何整体切换（innerHeight 与 vv.height 同源变化——真实浏览器中 layout viewport 缩放两者同步） */
function setViewport(vv: EventTarget & { height: number }, innerHeight: number, vvHeight = innerHeight) {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight })
    vv.height = vvHeight
    fire(vv, 'resize')
}

function focusInput() {
    const input = document.createElement('input')
    document.body.appendChild(input)
    // act 包裹：focusin 触发 store 写入，同步 flush 成 hook 提交（rAF 泵帧假体已随逐帧动画退场）
    act(() => { input.focus() })
    return input
}

beforeEach(() => {
    // store 是模块级单源、跨测试存活，用例间归零
    resetKeyboardViewportForTests()
})

afterEach(() => {
    cleanup()
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'virtualKeyboard', { configurable: true, value: undefined })
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    document.querySelectorAll('input, textarea').forEach(el => el.remove())
    vi.restoreAllMocks()
})

describe('useKeyboardViewportSelector（vv 模式：无 VirtualKeyboard API）', () => {
    it('无输入焦点时 innerHeight 回落（桌面缩放恢复）→ 基线跟随回落，不残留假键盘 inset', () => {
        const vv = stubVisualViewport()
        setViewport(vv, 800)
        const { result } = renderHook(() => useKeyboardViewportSelector(s => s.keyboardInset))

        // 环境变大（Ctrl+- 放大视口）再恢复（Ctrl+0）：回落幅度 ≥ 阈值也不得判为键盘
        setViewport(vv, 1000)
        expect(result.current).toBe(0)
        setViewport(vv, 800)
        expect(result.current).toBe(0)
    })

    it('焦点在输入框且 innerHeight 缩水（Android resize 模式键盘弹出）→ 正确检出 inset', () => {
        const vv = stubVisualViewport()
        setViewport(vv, 800)
        const kb = renderHook(() => useKeyboardViewportSelector(s => s.keyboardInset))
        const layout = renderHook(() => useKeyboardViewportSelector(s => s.layoutInset))

        focusInput()
        // Android resize 模式：键盘弹出 layout viewport 缩到键盘上方，innerHeight ≈ vv.height
        setViewport(vv, 400)
        expect(kb.result.current).toBe(400)
        expect(layout.result.current).toBe(0)
    })

    it('键盘收起（焦点仍在但可视高度恢复）→ inset 归零', () => {
        const vv = stubVisualViewport()
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
        const kb = renderHook(() => useKeyboardViewportSelector(s => s.keyboardInset))

        focusInput()
        setViewport(vv, 400)
        expect(kb.result.current).toBe(400)

        // 键盘收起：layout viewport 回到全高（焦点尚未 blur 的真实时序）
        setViewport(vv, 800)
        expect(kb.result.current).toBe(0)

        // iOS 模型：innerHeight 恒定，键盘弹出/收起只裁 vv.height
        setViewport(vv, 800, 400)
        expect(kb.result.current).toBe(400)
        setViewport(vv, 800, 800)
        expect(kb.result.current).toBe(0)
    })
})

describe('useKeyboardViewportSelector（overlay 模式：事件时刻写一次终值，CSS transition 插值）', () => {
    it('geometrychange 终值立即生效：store 与 --kb-inset 一跳到位（平滑归消费端 transition）', () => {
        const vk = stubVirtualKeyboard()
        const kb = renderHook(() => useKeyboardViewportSelector(s => s.keyboardInset))
        const layout = renderHook(() => useKeyboardViewportSelector(s => s.layoutInset))

        expect(kb.result.current).toBe(0)

        // 键盘弹出：真机只给终值（boundingRect 233），store 即刻落终值
        fireGeometry(vk, 233)
        expect(kb.result.current).toBe(233)
        expect(layout.result.current).toBe(233)
        expect(document.documentElement.style.getPropertyValue(KB_INSET_CSS_VAR)).toBe('233px')

        // 高度重定向（用户切了键盘布局）：新终值直接生效，不卡旧值
        fireGeometry(vk, 300)
        expect(kb.result.current).toBe(300)

        // 键盘收起：终值 0
        fireGeometry(vk, 0)
        expect(kb.result.current).toBe(0)
        expect(layout.result.current).toBe(0)
        expect(document.documentElement.style.getPropertyValue(KB_INSET_CSS_VAR)).toBe('0px')
    })

    it('focusin 预测：有记忆高度时聚焦即刻腾出，不等终值事件', () => {
        const vk = stubVirtualKeyboard()
        const kb = renderHook(() => useKeyboardViewportSelector(s => s.keyboardInset))

        // 建立记忆高度（弹一次再收）
        fireGeometry(vk, 233)
        fireGeometry(vk, 0)
        expect(kb.result.current).toBe(0)

        // 再聚焦：geometrychange 未至（真机滑动期无事件），store 已落记忆高度
        const input = focusInput()
        expect(kb.result.current).toBe(233)

        // 终值确认（真值与记忆一致）：计算值不变，无扰动
        fireGeometry(vk, 233)
        expect(kb.result.current).toBe(233)

        input.blur()
    })

    it('focusout 收起：宽限期后归零；输入框切换（A→B）不触发收起', async () => {
        const vk = stubVirtualKeyboard()
        const kb = renderHook(() => useKeyboardViewportSelector(s => s.keyboardInset))

        fireGeometry(vk, 233)
        expect(kb.result.current).toBe(233)

        // A→B 切换：已展开时 focusin 不重折腾腾出，宽限期内也不收
        const b = focusInput()
        await wait(30)
        expect(kb.result.current).toBe(233)

        // 真收起：focusout 且宽限期满无新焦点 → 归零
        act(() => { b.blur() })
        await wait(130)
        expect(kb.result.current).toBe(0)
        expect(document.documentElement.style.getPropertyValue(KB_INSET_CSS_VAR)).toBe('0px')
    })

    it('假弹回退：focusin 预测后确认窗口内无 geometrychange → 自动收回', async () => {
        const vk = stubVirtualKeyboard()
        const kb = renderHook(() => useKeyboardViewportSelector(s => s.keyboardInset))

        // 记忆高度
        fireGeometry(vk, 233)
        fireGeometry(vk, 0)

        // 聚焦但键盘不来（外接键盘/平板）：预测腾出后 700ms 无确认，收回
        const input = focusInput()
        expect(kb.result.current).toBe(233)
        await wait(720)
        expect(kb.result.current).toBe(0)
        input.blur()
    })

    it('可见性保护：腾出动画沉降后把仍聚焦的输入框滚入可视区（overlay 模式浏览器不再代劳）', async () => {
        const vk = stubVirtualKeyboard()
        renderHook(() => useKeyboardViewportSelector(s => s.keyboardInset))

        const scrolledTo: Element[] = []
        const input = focusInput()
        input.scrollIntoView = (arg?: boolean | ScrollIntoViewOptions) => { scrolledTo.push(input); void arg }

        // 建立记忆高度并弹出（终值即时到位），等沉降检查触发
        fireGeometry(vk, 233)
        await wait(360)
        expect(scrolledTo).toContain(input)
        input.blur()
    })

    it('可见性保护不抢滚动权：聚焦后被点走 / inset 已归零则不滚动', async () => {
        const vk = stubVirtualKeyboard()
        renderHook(() => useKeyboardViewportSelector(s => s.keyboardInset))

        const scrolledTo: Element[] = []
        const input = focusInput()
        input.scrollIntoView = () => { scrolledTo.push(input) }

        // 立刻点走（焦点转移）：focusin 重排到新目标，沉降期检查时旧目标不滚
        const other = focusInput()
        other.scrollIntoView = () => { scrolledTo.push(other) }
        fireGeometry(vk, 233)
        await wait(360)
        expect(scrolledTo).not.toContain(input)
        expect(scrolledTo).toContain(other)
        other.blur()
    })

    it('可见性 guard：视觉不可见的聚焦目标（蜜罐/折叠卡片/捕获层）不滚动', async () => {
        const vk = stubVirtualKeyboard()
        renderHook(() => useKeyboardViewportSelector(s => s.keyboardInset))

        let scrolled = 0
        const hidden = document.createElement('input')
        document.body.appendChild(hidden)
        hidden.style.visibility = 'hidden'
        hidden.scrollIntoView = () => { scrolled += 1 }
        hidden.focus()
        fireGeometry(vk, 233)
        await wait(360)
        expect(scrolled).toBe(0)
        hidden.blur()
    })

    it('resize 广播只在终值帧发生一次（逐帧风暴是掉帧元凶，不得回归）；收起不广播', () => {
        const vk = stubVirtualKeyboard()
        renderHook(() => useKeyboardViewportSelector(s => s.keyboardInset))
        const events: Event[] = []
        const onResize = (e: Event) => { events.push(e) }
        window.addEventListener('resize', onResize)
        try {
            // 一次终值写入恰好一次广播（旧逐帧实现 280ms 动画会广播 ~17 次）；收起（0）不广播
            fireGeometry(vk, 233)
            expect(events.length).toBe(1)
            fireGeometry(vk, 300)
            expect(events.length).toBe(2)
            fireGeometry(vk, 0)
            expect(events.length).toBe(2)
        } finally {
            window.removeEventListener('resize', onResize)
        }
    })

    it('overlay 模式下 vv 事件不再驱动 inset（防双源互相踩）', () => {
        const vk = stubVirtualKeyboard()
        const vv = stubVisualViewport()
        setViewport(vv, 800)
        const kb = renderHook(() => useKeyboardViewportSelector(s => s.keyboardInset))

        focusInput()
        // resize 语义的 vv 收缩在 overlay 模式不会发生；即便发生也不得误报键盘
        setViewport(vv, 400)
        expect(kb.result.current).toBe(0)
        // 键盘几何只认 geometrychange 终值
        fireGeometry(vk, 260)
        expect(kb.result.current).toBe(260)
    })

    it('带 API 但 overlaysContent 未开 → 仍走 vv 路径（与浏览器/CSS 消费同一 flag 权威）', () => {
        const vk = stubVirtualKeyboard()
        vk.overlaysContent = false
        const vv = stubVisualViewport()
        setViewport(vv, 800)
        const kb = renderHook(() => useKeyboardViewportSelector(s => s.keyboardInset))

        focusInput()
        // 浏览器在收缩视口（resize 模式）→ vv 数学是正确源；geometrychange 不驱动
        setViewport(vv, 400)
        expect(kb.result.current).toBe(400)
        fireGeometry(vk, 260)
        expect(kb.result.current).toBe(400)
    })
})

describe('selector 切片订阅的渲染纪律（code-review 2026-10-31 修复的行为锚）', () => {
    it('布尔切片只在翻转时重渲染：inset 变化不掀页级组件', () => {
        const vv = stubVisualViewport()
        setViewport(vv, 800)
        let renders = 0
        const { result } = renderHook(() => {
            renders += 1
            return useKeyboardViewportSelector(s => s.keyboardInset > 0)
        })
        expect(result.current).toBe(false)
        const initialRenders = renders

        focusInput()
        // 翻转 false→true
        setViewport(vv, 500)
        expect(result.current).toBe(true)
        const afterFlip = renders
        // 后续 inset 数值变化（同键盘周期）布尔不变 → 不得重渲染
        setViewport(vv, 480)
        setViewport(vv, 460)
        expect(result.current).toBe(true)
        expect(renders).toBe(afterFlip)
        // 翻转本身恰好引发一次重渲染（StrictMode 双渲染下用相对断言）
        expect(afterFlip).toBeGreaterThan(initialRenders)
    })
})

describe('常驻 watcher（布局消费面不依赖页面组件订阅）', () => {
    it('无 React 订阅时 ensure 挂载即驱动 CSS 变量，释放后归零清除', () => {
        const vk = stubVirtualKeyboard()
        // 关键：不经 renderHook，模拟设置页等无订阅路由
        const release = ensureKeyboardViewportWatchers()
        try {
            fireGeometry(vk, 233)
            expect(document.documentElement.style.getPropertyValue(KB_INSET_CSS_VAR)).toBe('233px')
        } finally {
            release()
        }
        // 末位释放：变量清除（store 归零由 reset 在下个用例兜底）
        expect(document.documentElement.style.getPropertyValue(KB_INSET_CSS_VAR)).toBe('')
    })
})
