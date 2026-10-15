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
 * 消息流复制按钮适配壳（uiarc copy-button iconOnly 形态）：
 * - 可访问名走 i18n key（label/aria-label）；
 * - 复制成功后 aria-live status 区报「label: 已复制」，2s 后复位；
 * - clipboard 失败时报失败文案（useCopyFeedback 降级路径）。
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { CopyButton } from '@/ui/shared/CopyButton'

const writeTextSpy = vi.hoisted(() => vi.fn<(text: string) => Promise<void>>())

vi.mock('react-i18next', async (orig) => {
    const actual = await orig()
    return {
        ...actual,
        useTranslation: () => ({ t: (k: string) => k }),
    }
})

beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextSpy },
        configurable: true,
        writable: true,
    })
})

afterEach(() => {
    cleanup()
    writeTextSpy.mockReset()
    vi.useRealTimers()
})

describe('CopyButton 适配壳', () => {
    it('可访问名走 i18n key，点击复制成功后 status 区报告知', async () => {
        writeTextSpy.mockResolvedValue(undefined)
        render(<CopyButton text="hello" />)

        const button = screen.getByRole('button', { name: 'chat.copy' })
        fireEvent.click(button)

        await waitFor(() => {
            expect(writeTextSpy).toHaveBeenCalledWith('hello')
            expect(screen.getByRole('status').textContent).toBe('chat.copy: chat.copied')
        })
    })

    it('复制失败时 status 区报失败文案', async () => {
        writeTextSpy.mockRejectedValue(new Error('denied'))
        render(<CopyButton text="hello" />)

        fireEvent.click(screen.getByRole('button', { name: 'chat.copy' }))

        await waitFor(() => {
            expect(screen.getByRole('status').textContent).toBe('chat.copy: chat.copyFailed')
        })
    })

    it('反馈 2s 后复位（status 区清空）', async () => {
        vi.useFakeTimers()
        writeTextSpy.mockResolvedValue(undefined)
        render(<CopyButton text="hello" />)

        fireEvent.click(screen.getByRole('button', { name: 'chat.copy' }))
        // fake timers 下异步 setState 须由 act 驱动 flush
        await act(async () => {
            await vi.advanceTimersByTimeAsync(50)
        })
        expect(screen.getByRole('status').textContent).toBe('chat.copy: chat.copied')

        // 推进超过复位时长后 status 区清空
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2000)
        })
        expect(screen.getByRole('status').textContent).toBe('')
    })
})
