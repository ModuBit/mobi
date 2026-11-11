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
 * - 按下可交互语义元素（button / ARIA 交互角色 / 原生 checkbox·radio）→ tap 一下
 * - 一次按下至多一触（组件层不再挂载，杜绝「试一下」曾经的叠加双震）
 * - 不可交互态（disabled / aria-disabled / aria-busy）不震
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

function down(el: Element): void {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
}

function mount(html: string): HTMLElement {
    const host = document.createElement('div')
    host.innerHTML = html
    document.body.appendChild(host)
    hosts.push(host)
    return host
}

describe('installHapticFeedback 全局委托', () => {
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
        ['select 触发器（combobox，弹层语义的 aria-expanded 不受展开收起排除影响）', '<div role="combobox" aria-expanded="false">选择</div>'],
        ['原生 checkbox', '<input type="checkbox" />'],
        ['treeitem 叶子（点击文件）', '<div role="treeitem">文件</div>'],
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
        ['radio（Segmented/RadioGroup 底座）', '<input type="radio" />'],
    ])('%s 按下 → 不震', (_label, html) => {
        const host = mount(html)
        down(host.firstElementChild!)
        expect(vibrate).not.toHaveBeenCalled()
    })

    it.each([
        ['disabled', '<button disabled>禁</button>'],
        ['aria-disabled', '<button aria-disabled="true">禁</button>'],
        ['aria-busy（loading）', '<button aria-busy="true">载</button>'],
        ['aria-expanded（分组展开收起，真机反馈不要震）', '<button role="button" aria-expanded="true">组</button>'],
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
