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

/** TabStrip 导航纯函数的边界直测：端点不循环、连续 disabled 跳过、关闭后落点回退链 */

import { describe, it, expect } from 'vitest'
import { resolveTabNavKey, nextFocusAfterClose } from '@/ui/base/interactive/tabStripNavigation'

const on = () => ({ disabled: false })
const off = () => ({ disabled: true })

describe('resolveTabNavKey', () => {
    it('方向键在相邻项间移动', () => {
        const tabs = [on(), on(), on()]
        expect(resolveTabNavKey('ArrowRight', 0, tabs)).toBe(1)
        expect(resolveTabNavKey('ArrowLeft', 2, tabs)).toBe(1)
    })

    it('端点不循环——压住不动比绕回另一端更符合预期', () => {
        const tabs = [on(), on(), on()]
        expect(resolveTabNavKey('ArrowLeft', 0, tabs)).toBeNull()
        expect(resolveTabNavKey('ArrowRight', 2, tabs)).toBeNull()
    })

    it('跳过 disabled，连续多个也跳过', () => {
        const tabs = [on(), off(), off(), on()]
        expect(resolveTabNavKey('ArrowRight', 0, tabs)).toBe(3)
        expect(resolveTabNavKey('ArrowLeft', 3, tabs)).toBe(0)
    })

    it('目标侧全是 disabled → null（不越过去找反方向的）', () => {
        const tabs = [on(), off(), off()]
        expect(resolveTabNavKey('ArrowRight', 0, tabs)).toBeNull()
    })

    it('Home / End 落到首末启用项', () => {
        const tabs = [off(), on(), on(), off()]
        expect(resolveTabNavKey('Home', 2, tabs)).toBe(1)
        expect(resolveTabNavKey('End', 1, tabs)).toBe(2)
    })

    it('不认识的键与越界下标 → null', () => {
        const tabs = [on(), on()]
        expect(resolveTabNavKey('Enter', 0, tabs)).toBeNull()
        expect(resolveTabNavKey('ArrowRight', -1, tabs)).toBeNull()
        expect(resolveTabNavKey('ArrowRight', 5, tabs)).toBeNull()
    })
})

describe('nextFocusAfterClose', () => {
    it('中间项关闭后后一项顶上（原位）', () => {
        expect(nextFocusAfterClose(1, [on(), on()])).toBe(1)
    })

    it('首项关闭后原位由原来的第二项顶上', () => {
        // 关掉 [a,b,c] 的 a 后剩 [b,c]，落点 0
        expect(nextFocusAfterClose(0, [on(), on()])).toBe(0)
    })

    it('末项关闭后落到前一项', () => {
        expect(nextFocusAfterClose(2, [on(), on()])).toBe(1)
    })

    it('原位不可用则向前找，再不行向后找', () => {
        expect(nextFocusAfterClose(0, [off(), on()])).toBe(1)
        expect(nextFocusAfterClose(1, [on(), off()])).toBe(0)
    })

    it('一个可用的都没有 / 已空 → null', () => {
        expect(nextFocusAfterClose(0, [off(), off()])).toBeNull()
        expect(nextFocusAfterClose(0, [])).toBeNull()
    })
})
