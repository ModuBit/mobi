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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSwitchConfirmation } from '@/ui/switchConfirmation'
import { interpretKeyChunk } from '@/ui/switchKeys'

const feed = (
    controls: ReturnType<typeof createSwitchConfirmation>,
    chunk: string,
): void => {
    for (const intent of interpretKeyChunk(chunk)) {
        controls.feed(intent)
    }
}

describe('createSwitchConfirmation', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('无 onExit 时 Ctrl-C 转发 SIGINT 给本进程', () => {
        const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
        const controls = createSwitchConfirmation({ onSwitch: vi.fn() })

        feed(controls, ' ')
        expect(controls.getState().confirmationMode).toBe('switch')

        feed(controls, '\x03')
        expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGINT')
        expect(controls.getState().confirmationMode).toBeNull()
    })

    it('二次 Ctrl-C 确认后执行 onExit', () => {
        const onExit = vi.fn()
        const controls = createSwitchConfirmation({ onExit })

        feed(controls, '\x03')
        expect(controls.getState().confirmationMode).toBe('exit')

        feed(controls, '\x03')
        expect(controls.getState().actionInProgress).toBe('exiting')
        vi.advanceTimersByTime(200)
        expect(onExit).toHaveBeenCalledTimes(1)
    })

    it('二次 space 确认后执行 onSwitch', () => {
        const onSwitch = vi.fn()
        const controls = createSwitchConfirmation({ onSwitch })

        feed(controls, ' ')
        expect(controls.getState().confirmationMode).toBe('switch')

        feed(controls, ' ')
        expect(controls.getState().actionInProgress).toBe('switching')
        vi.advanceTimersByTime(200)
        expect(onSwitch).toHaveBeenCalledTimes(1)
    })

    it('key-release 序列不清除待确认', () => {
        const onSwitch = vi.fn()
        const controls = createSwitchConfirmation({ onSwitch })

        feed(controls, ' ')
        expect(controls.getState().confirmationMode).toBe('switch')

        feed(controls, '\u001b[1:3u')
        feed(controls, '\u001b[32;2:3u')
        expect(controls.getState().confirmationMode).toBe('switch')
        expect(onSwitch).not.toHaveBeenCalled()
    })

    it('key-release 空格不触发切换（单发也不进确认）', () => {
        const onSwitch = vi.fn()
        const controls = createSwitchConfirmation({ onSwitch })

        feed(controls, '\u001b[3:3u')
        expect(controls.getState().confirmationMode).toBeNull()
        expect(onSwitch).not.toHaveBeenCalled()
    })

    it('其他可打印字符清除待确认', () => {
        const onSwitch = vi.fn()
        const controls = createSwitchConfirmation({ onSwitch })

        feed(controls, ' ')
        feed(controls, 'x')
        expect(controls.getState().confirmationMode).toBeNull()

        // 清除后再次 space 是重新进入确认而非执行
        feed(controls, ' ')
        expect(controls.getState().confirmationMode).toBe('switch')
        expect(onSwitch).not.toHaveBeenCalled()
    })

    it('待确认超时自动清除', () => {
        const onSwitch = vi.fn()
        const controls = createSwitchConfirmation({ onSwitch, confirmationTimeoutMs: 5000 })

        feed(controls, ' ')
        expect(controls.getState().confirmationMode).toBe('switch')

        vi.advanceTimersByTime(5000)
        expect(controls.getState().confirmationMode).toBeNull()

        // 超时后二次 space 是重新确认而非执行
        feed(controls, ' ')
        expect(controls.getState().confirmationMode).toBe('switch')
        expect(onSwitch).not.toHaveBeenCalled()
    })

    it('动作执行期间忽略后续按键', () => {
        const onExit = vi.fn()
        const controls = createSwitchConfirmation({ onExit })

        feed(controls, '\x03')
        feed(controls, '\x03')
        feed(controls, ' ')
        expect(controls.getState().actionInProgress).toBe('exiting')
        vi.advanceTimersByTime(200)
        expect(onExit).toHaveBeenCalledTimes(1)
    })

    it('无 onSwitch 时 space 按可打印处理（清确认）', () => {
        const onExit = vi.fn()
        const controls = createSwitchConfirmation({ onExit })

        feed(controls, '\x03')
        expect(controls.getState().confirmationMode).toBe('exit')

        feed(controls, ' ')
        expect(controls.getState().confirmationMode).toBeNull()
    })

    it('dispose 清理定时器且不触发回调', () => {
        const onSwitch = vi.fn()
        const controls = createSwitchConfirmation({ onSwitch, confirmationTimeoutMs: 5000 })

        feed(controls, ' ')
        controls.dispose()
        vi.advanceTimersByTime(10_000)
        expect(controls.getState().confirmationMode).toBe('switch')
        expect(onSwitch).not.toHaveBeenCalled()
    })
})
