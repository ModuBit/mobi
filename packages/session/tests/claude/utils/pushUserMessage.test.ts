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
 * 验证 pushUserMessage 的 nativeId 预设与绑定上报行为。
 *
 * 背景：SDK 采纳输入侧预设的 SDKUserMessage.uuid（回显与 transcript 均用它），
 * uuid 即该消息在 CC transcript 与文件 checkpoint 的锚点。push 那一刻
 * (localIds, nativeId) 配对即确定，立即经 onBound 上报。
 *
 * @see packages/cli/src/claude/utils/pushUserMessage.ts
 */

import { describe, test, expect, vi } from 'vitest'
import { pushUserMessage } from '../../../src/claude/utils/pushUserMessage'

function makeMessages() {
    return { push: vi.fn() }
}

describe('pushUserMessage', () => {
    test('push 携带生成的 uuid，且上报绑定', () => {
        const messages = makeMessages()
        const onBound = vi.fn()
        pushUserMessage(messages as never, 'hello', { localIds: ['local-1'], onBound })
        const pushed = messages.push.mock.calls[0][0]
        expect(pushed.type).toBe('user')
        expect(pushed.uuid).toMatch(/^[0-9a-f-]{36}$/)
        expect(pushed.message.content).toBe('hello')
        expect(onBound).toHaveBeenCalledWith({ localIds: ['local-1'], nativeId: pushed.uuid })
    })

    test('localIds 为空 → 不上报（注入路径）', () => {
        const messages = makeMessages()
        const onBound = vi.fn()
        pushUserMessage(messages as never, 'injected', { onBound })
        expect(messages.push).toHaveBeenCalledTimes(1)
        expect(onBound).not.toHaveBeenCalled()
    })

    test('数组 payload 原样透传为 message.content（不做任何内容处理）', () => {
        const messages = makeMessages()
        const blocks = [
            { type: 'text', text: 'hello' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
        ] as const
        pushUserMessage(messages as never, [...blocks], {})
        const pushed = messages.push.mock.calls[0][0]
        expect(pushed.message.content).toEqual(blocks)
    })
})
