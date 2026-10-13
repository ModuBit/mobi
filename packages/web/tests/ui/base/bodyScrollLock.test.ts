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
 * 自建滚动锁的不变量：钉住 body（不改事件层 → 不碰 shadow DOM 里的滚动区）、
 * 引用计数（嵌套 sheet）、释放时还原原样式与滚动位置。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { lockBodyScroll, __resetBodyScrollLockForTest } from '@/ui/base/interactive/bodyScrollLock'

describe('lockBodyScroll', () => {
    beforeEach(() => {
        __resetBodyScrollLockForTest()
        document.body.removeAttribute('style')
        vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.restoreAllMocks()
        document.body.removeAttribute('style')
    })

    it('上锁钉住 body（position: fixed + top 偏移），释放后原样还原', () => {
        document.body.style.background = 'red'
        const release = lockBodyScroll()

        expect(document.body.style.position).toBe('fixed')
        expect(document.body.style.overflow).toBe('hidden')
        expect(document.body.style.top).toMatch(/^-?\d+px$/)  // 顶掉当前滚动位置（jsdom 里 scrollY 恒 0）

        release()
        expect(document.body.getAttribute('style')).toBe('background: red;')
        expect(window.scrollTo).toHaveBeenCalled()
    })

    it('引用计数：嵌套 sheet，先释放的那个不还原，最后一个释放才还原', () => {
        const first = lockBodyScroll()
        const second = lockBodyScroll()

        first()
        expect(document.body.style.position).toBe('fixed')  // 还有一层没释放

        second()
        expect(document.body.style.position).toBe('')
    })

    it('释放函数幂等：重复调用不会把别人的锁一起解掉', () => {
        const first = lockBodyScroll()
        lockBodyScroll()
        first()
        first()
        expect(document.body.style.position).toBe('fixed')
    })
})
