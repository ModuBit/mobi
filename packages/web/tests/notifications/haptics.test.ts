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
 * haptics 单源契约：
 * - pattern 是「短轻柔」形态：单段震动 ≤30ms（tap/ready/pending 三档语义递进）
 * - vibratePattern 透传 pattern 且返回 API 接受与否；无 API / 抛错一律 false 不抛
 * - hapticTap 固定走 tap pattern
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { HAPTIC_PATTERNS, vibratePattern, hapticTap } from '@/core/notifications/haptics'

describe('HAPTIC_PATTERNS', () => {
    it('短轻柔约束：每段震动 ≤30ms（与系统 touch haptics 同量级）', () => {
        for (const pattern of Object.values(HAPTIC_PATTERNS)) {
            // 偶数位是震动时长，奇数位是停顿——只约束震动段
            pattern.filter((_, i) => i % 2 === 0).forEach((ms) => {
                expect(ms).toBeLessThanOrEqual(30)
                expect(ms).toBeGreaterThan(0)
            })
        }
    })

    it('三档语义齐备：tap / ready / pending', () => {
        expect(Object.keys(HAPTIC_PATTERNS).sort()).toEqual(['pending', 'ready', 'tap'])
    })
})

describe('vibratePattern', () => {
    const nav = navigator as { vibrate?: unknown } & typeof navigator
    let originalVibrate: unknown

    beforeEach(() => {
        originalVibrate = Object.getOwnPropertyDescriptor(nav, 'vibrate')?.value
    })

    afterEach(() => {
        Object.defineProperty(nav, 'vibrate', { value: originalVibrate, configurable: true })
    })

    function mockVibrate(impl?: (...args: unknown[]) => unknown): ReturnType<typeof vi.fn> {
        const fn = vi.fn(impl)
        Object.defineProperty(nav, 'vibrate', { value: fn, configurable: true })
        return fn
    }

    it('透传 pattern 并返回 API 返回值', () => {
        const vibrate = mockVibrate(() => true)
        expect(vibratePattern([20])).toBe(true)
        expect(vibrate).toHaveBeenCalledWith([20])
    })

    it('API 返回 false（被浏览器拦截/无振动器）→ false', () => {
        mockVibrate(() => false)
        expect(vibratePattern([10])).toBe(false)
    })

    it('无 vibrate API（iOS Safari 等）→ false 不抛', () => {
        Object.defineProperty(nav, 'vibrate', { value: undefined, configurable: true })
        expect(vibratePattern([10])).toBe(false)
    })

    it('实现抛错（权限异常等）→ false 不抛', () => {
        mockVibrate(() => { throw new Error('blocked') })
        expect(vibratePattern([10])).toBe(false)
    })
})

describe('hapticTap', () => {
    const nav = navigator as { vibrate?: unknown } & typeof navigator
    let originalVibrate: unknown

    beforeEach(() => {
        originalVibrate = Object.getOwnPropertyDescriptor(nav, 'vibrate')?.value
    })

    afterEach(() => {
        Object.defineProperty(nav, 'vibrate', { value: originalVibrate, configurable: true })
    })

    it('固定走 tap pattern，无返回值', () => {
        const vibrate = vi.fn(() => true)
        Object.defineProperty(nav, 'vibrate', { value: vibrate, configurable: true })
        expect(hapticTap()).toBeUndefined()
        expect(vibrate).toHaveBeenCalledWith([...HAPTIC_PATTERNS.tap])
    })
})
