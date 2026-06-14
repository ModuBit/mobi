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
 * vconsole 启用策略单元测试
 * 验证移动端设备判定逻辑（基于 pointer: coarse）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isMobileDevice } from '@/core/lib/vconsole'

/** mock window.matchMedia，matches 表示 (pointer: coarse) 是否匹配 */
function mockMatchMedia(matches: boolean) {
    return vi.fn().mockReturnValue({
        matches,
        media: '(pointer: coarse)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })
}

describe('isMobileDevice', () => {
    beforeEach(() => {
        sessionStorage.clear()
    })

    it('触屏设备（pointer: coarse 匹配）判定为移动端', () => {
        vi.stubGlobal('matchMedia', mockMatchMedia(true))
        expect(isMobileDevice()).toBe(true)
    })

    it('鼠标设备（pointer: fine，coarse 不匹配）非移动端', () => {
        vi.stubGlobal('matchMedia', mockMatchMedia(false))
        expect(isMobileDevice()).toBe(false)
    })
})
