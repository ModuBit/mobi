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

import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock 外部依赖：fetchEventSource 默认立即 resolve，模拟一次成功建连
vi.mock('@microsoft/fetch-event-source', () => ({
    fetchEventSource: vi.fn(async () => {}),
}))

import { fetchEventSource } from '@microsoft/fetch-event-source'
import { SSEClient } from '@/core/data/realtime/sseClient'

describe('SSEClient 后台连接稳定性', () => {
    beforeEach(() => {
        vi.mocked(fetchEventSource).mockClear()
        vi.mocked(fetchEventSource).mockResolvedValue(undefined)
    })

    it('切走页面/最小化时保持 SSE 连接（openWhenHidden: true）', async () => {
        // @microsoft/fetch-event-source 默认 openWhenHidden=false，
        // 页面进入 hidden 会主动 abort 连接——必须显式覆盖为 true
        const client = new SSEClient(() => 'http://localhost/api/events?token=t')
        await client.connect()

        expect(fetchEventSource).toHaveBeenCalledTimes(1)
        const options = vi.mocked(fetchEventSource).mock.calls[0][1]
        expect(options.openWhenHidden).toBe(true)
    })

    it('正常传入 URL 与 abort signal', async () => {
        const url = 'http://localhost/api/events?token=abc'
        const client = new SSEClient(() => url)
        await client.connect()

        expect(fetchEventSource).toHaveBeenCalledTimes(1)
        const [calledUrl] = vi.mocked(fetchEventSource).mock.calls[0]
        expect(calledUrl).toBe(url)
        // signal 用于 disconnect 时 abort，必须存在
        expect(vi.mocked(fetchEventSource).mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    })

    it('disconnect 后 abort signal 被触发', async () => {
        const client = new SSEClient(() => 'http://localhost/api/events?token=t')
        await client.connect()
        const signal = vi.mocked(fetchEventSource).mock.calls[0][1].signal
        expect(signal.aborted).toBe(false)

        client.disconnect()
        expect(signal.aborted).toBe(true)
    })
})
