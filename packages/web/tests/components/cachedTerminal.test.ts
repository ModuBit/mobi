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

import { describe, expect, it, vi, beforeEach } from 'vitest'

// mock socket.io-client：捕获 io() 调用参数，断言不含 auth.token
const ioMock = vi.fn()
vi.mock('socket.io-client', () => ({
    io: (...args: unknown[]) => {
        ioMock(...args)
        return {
            on: vi.fn(),
            emit: vi.fn(),
            connect: vi.fn(),
            disconnect: vi.fn(),
            removeAllListeners: vi.fn(),
            connected: false,
        }
    },
}))

import { createCachedTerminal } from '@/components/terminal/cachedTerminal'

describe('cachedTerminal（C-T3 cookie 闭环）', () => {
    beforeEach(() => {
        ioMock.mockClear()
    })

    it('io() 不带 auth.token（同源 httpOnly cookie 自动携带）', () => {
        createCachedTerminal({ sessionId: 'test-session' })

        expect(ioMock).toHaveBeenCalledTimes(1)
        const [, options] = ioMock.mock.calls[0] as [string, Record<string, unknown>]
        expect(options).toBeDefined()
        expect(options).not.toHaveProperty('auth')
        // 其余配置保留
        expect(options.transports).toEqual(['websocket'])
        expect(options.path).toBe('/socket.io')
    })
})
