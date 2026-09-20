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
 * 引用条目点击 → 消息级定位（票 06）：命中滚动 + 高亮、display:contents 锚点解盒、
 * 窗口外静默三条外部行为。jsdom 无 scrollIntoView 与动画，均按约定 mock / 断言类名。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { locateQuotedMessage, QUOTE_FLASH_CLASS } from '@/domain/chat/quoteLocate'

const FLASH_MS = 1200

describe('locateQuotedMessage 消息级定位', () => {
    let scrollIntoView: ReturnType<typeof vi.fn>

    beforeEach(() => {
        vi.useFakeTimers()
        scrollIntoView = vi.fn()
        // jsdom 未实现 scrollIntoView，挂 mock 后断言调用目标与参数
        Element.prototype.scrollIntoView = scrollIntoView
    })

    afterEach(() => {
        vi.useRealTimers()
        document.body.innerHTML = ''
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    })

    it('命中：平滑滚动居中 + 高亮类落真实盒后代，时长到期摘除', () => {
        document.body.innerHTML =
            '<div data-quote-message-id="m1" style="display: contents"><div class="collapsible-user-msg"></div></div>'
        const anchor = document.querySelector('[data-quote-message-id="m1"]')!
        const target = anchor.firstElementChild as HTMLElement

        locateQuotedMessage('m1')

        // display:contents 锚点无盒（「零矩形」坑）→ scrollIntoView 委托到首个真实盒后代
        expect(scrollIntoView).toHaveBeenCalledTimes(1)
        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
        expect(scrollIntoView.mock.instances[0]).toBe(target)
        expect(target.classList.contains(QUOTE_FLASH_CLASS)).toBe(true)

        // 闪烁动画时长到期后摘类（定时器摘除，不用 animationend——jsdom 不跑动画）
        vi.advanceTimersByTime(FLASH_MS)
        expect(target.classList.contains(QUOTE_FLASH_CLASS)).toBe(false)
    })

    it('未命中（源消息不在当前滑动窗口）：静默无反应', () => {
        document.body.innerHTML = '<div data-quote-message-id="other"></div>'
        expect(() => locateQuotedMessage('missing')).not.toThrow()
        expect(scrollIntoView).not.toHaveBeenCalled()
    })

    it('锚点非 display:contents 时直接定位锚点自身', () => {
        document.body.innerHTML = '<div data-quote-message-id="m2"></div>'
        const anchor = document.querySelector('[data-quote-message-id="m2"]')!

        locateQuotedMessage('m2')

        expect(scrollIntoView.mock.instances[0]).toBe(anchor)
    })
})
