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
 * isSubmitEnter：单行输入的回车提交键位判定。
 * 重点回归 WebKit 的 compositionend 时序——确认候选词的 Enter 到达 keydown 时
 * isComposing 已翻 false，只剩 keyCode 229 可辨认。
 */

import { describe, expect, it } from 'vitest'
import { isSubmitEnter } from '@/core/lib/inputEnterKeys'

function enterEvent(isComposing: boolean, keyCode?: number) {
    return { key: 'Enter', nativeEvent: { isComposing, keyCode } }
}

describe('isSubmitEnter', () => {
    it('普通 Enter → 提交', () => {
        expect(isSubmitEnter(enterEvent(false, 13))).toBe(true)
    })

    it('isComposing=true 的 Enter 是确认候选词 → 不提交', () => {
        expect(isSubmitEnter(enterEvent(true, 229))).toBe(false)
        expect(isSubmitEnter(enterEvent(true, 13))).toBe(false)
    })

    it('keyCode 229（isComposing 已翻 false）→ 不提交', () => {
        // WebKit：compositionend 先于 keydown 派发，只剩 229 可辨认组合残留
        expect(isSubmitEnter(enterEvent(false, 229))).toBe(false)
    })

    it('非 Enter 键 → false', () => {
        expect(isSubmitEnter({ key: 'a', nativeEvent: { isComposing: false, keyCode: 65 } })).toBe(false)
    })
})
