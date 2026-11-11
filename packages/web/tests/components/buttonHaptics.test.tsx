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
 * Button 族触觉反馈契约（Android 原生 touch haptics 同时机 = pointerdown 即震）：
 * - 可交互态按下 → navigator.vibrate 收到 tap pattern
 * - 不可交互态（loading / aria-disabled）不震
 * - 消费方自己的 onPointerDown 无论震不震都原样接续（链不丢）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { Button } from '@/ui/base/interactive/button/Button'
import { IconButton } from '@/ui/base/interactive/IconButton'
import { HAPTIC_PATTERNS } from '@/core/notifications/haptics'

const nav = navigator as { vibrate?: unknown } & typeof navigator
let originalVibrate: unknown

function mockVibrate(): ReturnType<typeof vi.fn> {
    const fn = vi.fn(() => true)
    Object.defineProperty(nav, 'vibrate', { value: fn, configurable: true })
    return fn
}

beforeEach(() => {
    originalVibrate = Object.getOwnPropertyDescriptor(nav, 'vibrate')?.value
})

afterEach(() => {
    Object.defineProperty(nav, 'vibrate', { value: originalVibrate, configurable: true })
    cleanup()
})

describe('Button 触觉反馈', () => {
    it('pointerdown → vibrate 收到 tap pattern', () => {
        const vibrate = mockVibrate()
        const { getByRole } = render(<Button>点我</Button>)
        fireEvent.pointerDown(getByRole('button'))
        expect(vibrate).toHaveBeenCalledWith([...HAPTIC_PATTERNS.tap])
    })

    it('消费方 onPointerDown 与震动同帧接续（参数原样透传）', () => {
        mockVibrate()
        const consumer = vi.fn()
        const { getByRole } = render(<Button onPointerDown={consumer}>点我</Button>)
        const event = new Event('pointerdown', { bubbles: true })
        getByRole('button').dispatchEvent(event)
        expect(consumer).toHaveBeenCalledTimes(1)
        // React 合成事件包装原生事件：nativeEvent 指向同一原始事件
        const synthetic = consumer.mock.calls[0]?.[0] as React.PointerEvent
        expect(synthetic.nativeEvent).toBe(event)
    })

    it('loading 态不震（点击被吞，触觉一并静默）', () => {
        const vibrate = mockVibrate()
        const { getByRole } = render(<Button loading>点我</Button>)
        fireEvent.pointerDown(getByRole('button'))
        expect(vibrate).not.toHaveBeenCalled()
    })
})

describe('IconButton 触觉反馈', () => {
    const renderIcon = (ui: React.ReactNode) =>
        render(<ConfigProvider>{ui}</ConfigProvider>)

    it('pointerdown → vibrate 收到 tap pattern', () => {
        const vibrate = mockVibrate()
        const { getByRole } = renderIcon(<IconButton icon={<span>i</span>} aria-label="op" />)
        fireEvent.pointerDown(getByRole('button'))
        expect(vibrate).toHaveBeenCalledWith([...HAPTIC_PATTERNS.tap])
    })

    it('loading 态不震', () => {
        const vibrate = mockVibrate()
        const { getByRole } = renderIcon(<IconButton icon={<span>i</span>} aria-label="op" loading />)
        fireEvent.pointerDown(getByRole('button'))
        expect(vibrate).not.toHaveBeenCalled()
    })

    it('无 vibrate API 环境不抛（iOS Safari）', () => {
        Object.defineProperty(nav, 'vibrate', { value: undefined, configurable: true })
        const { getByRole } = renderIcon(<IconButton icon={<span>i</span>} aria-label="op" />)
        expect(() => fireEvent.pointerDown(getByRole('button'))).not.toThrow()
    })
})
