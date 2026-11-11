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
 * 触觉反馈全局委托契约（installHapticFeedback，app 入口一次性安装）：
 * - 按下可交互语义元素（button / ARIA 交互角色 / 原生 checkbox·radio / data-haptic 声明）→ tap 一下
 * - 一次按下至多一触（组件层不再挂载，杜绝「试一下」曾经的叠加双震）
 * - 不可交互态（disabled / aria-disabled / aria-busy）不震
 * - 展开收起语义（aria-expanded 且无 aria-haspopup）不震；弹层开合（带 haspopup）震
 * - mouse 按下即刻震；touch 延迟确认——窗口内滚动/拖拽取消，pointerup 提前触发
 * - 非交互目标不震；无 Vibration API 环境不抛
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Button } from '@/ui/base/interactive/button/Button'
import { HAPTIC_PATTERNS, installHapticFeedback, setHapticGate, vibratePattern } from '@/core/notifications/haptics'

const nav = navigator as { vibrate?: unknown } & typeof navigator
let originalVibrate: unknown
let vibrate: ReturnType<typeof vi.fn>
/** mount 挂进 body 的宿主（afterEach 统一移除，防 role 冲突） */
let hosts: HTMLElement[] = []

beforeAll(() => {
    vi.useFakeTimers()
    installHapticFeedback()
})

beforeEach(() => {
    originalVibrate = Object.getOwnPropertyDescriptor(nav, 'vibrate')?.value
    vibrate = vi.fn(() => true)
    Object.defineProperty(nav, 'vibrate', { value: vibrate, configurable: true })
    hosts = []
})

afterEach(() => {
    Object.defineProperty(nav, 'vibrate', { value: originalVibrate, configurable: true })
    hosts.forEach((h) => h.remove())
    cleanup()
})

function down(el: Element, pointerType: PointerEventInit['pointerType'] = 'mouse'): void {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType, pointerId: 1, clientX: 100, clientY: 100 }))
}

function pointerUp(el: Element, pointerType: PointerEventInit['pointerType'] = 'mouse'): void {
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType, pointerId: 1, clientX: 100, clientY: 100 }))
}

function pointerMove(el: Element, x: number, y: number, pointerType: PointerEventInit['pointerType'] = 'touch'): void {
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType, pointerId: 1, clientX: x, clientY: y }))
}

function mount(html: string): HTMLElement {
    const host = document.createElement('div')
    host.innerHTML = html
    document.body.appendChild(host)
    hosts.push(host)
    return host
}

describe('installHapticFeedback 全局委托（mouse 按下即刻震）', () => {
    it('按下 button → tap pattern', () => {
        const host = mount('<button>点</button>')
        down(host.querySelector('button')!)
        expect(vibrate).toHaveBeenCalledTimes(1)
        expect(vibrate).toHaveBeenCalledWith([...HAPTIC_PATTERNS.tap])
    })

    it('button 内的子元素按下 → closest 命中 button 震一次（不叠加）', () => {
        const host = mount('<button><span>文案</span></button>')
        down(host.querySelector('span')!)
        expect(vibrate).toHaveBeenCalledTimes(1)
    })

    it.each([
        ['select 触发器（combobox，aria-expanded + aria-haspopup 弹层语义不受展开收起排除影响）', '<div role="combobox" aria-expanded="false" aria-haspopup="listbox">选择</div>'],
        ['原生 checkbox', '<input type="checkbox" />'],
        ['treeitem 叶子（点击文件）', '<div role="treeitem">文件</div>'],
        ['radio（离散确认动作，AskUserQuestion 单选项）', '<div role="radio" aria-checked="false">选项</div>'],
        ['data-haptic 声明通道（无交互角色的自定义行，如会话行）', '<div data-haptic="">会话</div>'],
    ])('%s 按下 → 震', (_label, html) => {
        const host = mount(html)
        down(host.firstElementChild!)
        expect(vibrate).toHaveBeenCalledTimes(1)
        expect(vibrate).toHaveBeenCalledWith([...HAPTIC_PATTERNS.tap])
    })

    it('data-haptic="confirm"（危险操作声明）→ confirm 双脉冲', () => {
        const host = mount('<button data-haptic="confirm">删除</button>')
        down(host.firstElementChild!)
        expect(vibrate).toHaveBeenCalledWith([...HAPTIC_PATTERNS.confirm])
    })

    it('danger 按钮子元素按下 → closest 命中声明，confirm 双脉冲', () => {
        const { getByRole } = render(<Button danger>删除</Button>)
        down(getByRole('button').querySelector('span') ?? getByRole('button'))
        expect(vibrate).toHaveBeenCalledWith([...HAPTIC_PATTERNS.confirm])
    })

    it.each([
        ['tab 页签（高频导航，2026-11-11 打扰面收窄移出）', '<div role="tab">标签</div>'],
        ['option 弹层选项', '<div role="option">选项</div>'],
        ['menuitem 菜单项', '<div role="menuitem">操作</div>'],
        ['radio input（Segmented/RadioGroup 底座，高频选择）', '<input type="radio" />'],
    ])('%s 按下 → 不震', (_label, html) => {
        const host = mount(html)
        down(host.firstElementChild!)
        expect(vibrate).not.toHaveBeenCalled()
    })

    it.each([
        ['disabled', '<button disabled>禁</button>'],
        ['aria-disabled', '<button aria-disabled="true">禁</button>'],
        ['aria-busy（loading）', '<button aria-busy="true">载</button>'],
        ['aria-expanded 无 haspopup（分组展开收起，真机反馈不要震）', '<button role="button" aria-expanded="true">组</button>'],
        ['treeitem 展开', '<div role="treeitem" aria-expanded="false">目录</div>'],
        ['summary 折叠头（原生展开语义）', '<summary>更多</summary>'],
        ['switch（状态切换控件，反馈由 onChange 按新状态决定）', '<button role="switch" aria-checked="false"></button>'],
    ])('%s 按下 → 不震', (_label, html) => {
        const host = mount(html)
        down(host.firstElementChild!)
        expect(vibrate).not.toHaveBeenCalled()
    })

    it('非交互目标（纯文本区域）不震', () => {
        const host = mount('<div><p>一段文字</p></div>')
        down(host.querySelector('p')!)
        expect(vibrate).not.toHaveBeenCalled()
    })

    it('disabled 容器内的可命中子元素不震（closest 命中 disabled 祖先时以其为准）', () => {
        // 委托 closest 从 target 找最近的交互元素；fieldset disabled 原生屏蔽 input，
        // button 上的 disabled 属性是直接判据——嵌套场景以最近命中元素属性为准
        const host = mount('<button disabled><span>文案</span></button>')
        down(host.querySelector('span')!)
        expect(vibrate).not.toHaveBeenCalled()
    })

    it('无 Vibration API 环境按下不抛', () => {
        Object.defineProperty(nav, 'vibrate', { value: undefined, configurable: true })
        const host = mount('<button>点</button>')
        expect(() => down(host.querySelector('button')!)).not.toThrow()
    })

    it('Button 组件（uiarc）按下同样被委托命中', () => {
        const { getByRole } = render(<Button>点我</Button>)
        down(getByRole('button'))
        expect(vibrate).toHaveBeenCalledTimes(1)
        expect(vibrate).toHaveBeenCalledWith([...HAPTIC_PATTERNS.tap])
    })
})

describe('touch 延迟确认（防滚动误震）', () => {
    it('touch 按下不动 → 延迟窗口到点后震', () => {
        const host = mount('<button>点</button>')
        down(host.querySelector('button')!, 'touch')
        expect(vibrate).not.toHaveBeenCalled()
        vi.advanceTimersByTime(80)
        expect(vibrate).toHaveBeenCalledTimes(1)
        expect(vibrate).toHaveBeenCalledWith([...HAPTIC_PATTERNS.tap])
    })

    it('touch 按下后快速抬起（tap）→ pointerup 提前触发震动', () => {
        const host = mount('<button>点</button>')
        down(host.querySelector('button')!, 'touch')
        pointerUp(host.querySelector('button')!, 'touch')
        expect(vibrate).toHaveBeenCalledTimes(1)
        // 提前触发后定时器已清，到点不再二次震
        vi.advanceTimersByTime(200)
        expect(vibrate).toHaveBeenCalledTimes(1)
    })

    it('touch 按下后位移越过 slop（滚动/拖拽开始）→ 取消震动', () => {
        const host = mount('<button>点</button>')
        down(host.querySelector('button')!, 'touch')
        pointerMove(host, 130, 100)
        vi.advanceTimersByTime(200)
        expect(vibrate).not.toHaveBeenCalled()
    })

    it('touch 按下后轻微位移（slop 内，手抖）→ 不取消', () => {
        const host = mount('<button>点</button>')
        down(host.querySelector('button')!, 'touch')
        pointerMove(host, 104, 102)
        vi.advanceTimersByTime(80)
        expect(vibrate).toHaveBeenCalledTimes(1)
    })

    it('容器 scroll 开始 → 取消挂起的震动', () => {
        const host = mount('<button>点</button>')
        down(host.querySelector('button')!, 'touch')
        window.dispatchEvent(new Event('scroll'))
        vi.advanceTimersByTime(200)
        expect(vibrate).not.toHaveBeenCalled()
    })
})

describe('震动开关 gate（setHapticGate 注入）', () => {
    it('gate 关闭后 vibratePattern 与委托都不震', () => {
        setHapticGate(() => false)
        expect(vibratePattern([10])).toBe(false)
        const host = mount('<button>点</button>')
        down(host.querySelector('button')!)
        expect(vibrate).not.toHaveBeenCalled()
    })

    it('gate 恢复放行后委托恢复震动', () => {
        setHapticGate(() => false)
        setHapticGate(() => true)
        const host = mount('<button>点</button>')
        down(host.querySelector('button')!)
        expect(vibrate).toHaveBeenCalledWith([...HAPTIC_PATTERNS.tap])
    })
})
