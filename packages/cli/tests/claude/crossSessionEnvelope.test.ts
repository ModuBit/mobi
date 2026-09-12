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

import { describe, it, expect } from 'vitest'
import { withCrossSessionEnvelope } from '@/claude/utils/crossSessionEnvelope'
import { parseInboundCrossSession } from '@/claude/utils/inboundCrossSession'
import { buildPromptFromBlocks } from '@/utils/promptBuilder'
import type { UserContentBlock } from '@mobi/shared'

const envelope = { fromName: 'Sender', fromSessionId: 'A', messageId: 'm1' }

/** payload 扁平化成一个字符串，交给入站解析器（它读的是 hook 拿到的 prompt 原文） */
function flatten(blocks: UserContentBlock[]): string {
    const prompt = buildPromptFromBlocks(blocks)
    return typeof prompt === 'string'
        ? prompt
        : prompt.map((element) => (element.type === 'text' ? element.text : '')).join('')
}

describe('withCrossSessionEnvelope', () => {
    it('首尾各一个 text block，中间原样不动', () => {
        const wrapped = withCrossSessionEnvelope([{ type: 'text', text: 'hello' }], envelope)

        expect(wrapped).toHaveLength(3)
        expect(wrapped[0].type).toBe('text')
        expect(wrapped[2].type).toBe('text')
        expect(wrapped[1]).toEqual({ type: 'text', text: 'hello' })
    })

    it('开标签带三个标识（from-name 与 CC 原生同形，另两个是 mobi 加的）', () => {
        const wrapped = withCrossSessionEnvelope([{ type: 'text', text: 'hi' }], envelope)

        expect(wrapped[0]).toEqual({
            type: 'text',
            text: '<cross-session-message from-name="Sender" from-session-id="A" message-id="m1">',
        })
        expect(wrapped[2]).toEqual({ type: 'text', text: '</cross-session-message>' })
    })

    it('带图消息：信封跨元素依然完整（图片夹在中间，不在信封外面）', () => {
        const image: UserContentBlock = {
            type: 'image',
            source: { type: 'url', value: '/tmp/a.png' },
            id: 'i1',
            filename: 'a.png',
            size: 10,
        }

        const wrapped = withCrossSessionEnvelope([{ type: 'text', text: 'look' }, image], envelope)

        expect(wrapped.map((block) => block.type)).toEqual(['text', 'text', 'image', 'text'])
        expect(wrapped[3].type === 'text' && wrapped[3].text).toBe('</cross-session-message>')
    })

    it('会话名里的引号 / 尖括号不会破坏标签，正文仍被完整切出', () => {
        const hostile = { ...envelope, fromName: 'say "hi" <now> & then' }

        const parsed = parseInboundCrossSession({
            prompt: flatten(withCrossSessionEnvelope([{ type: 'text', text: 'body' }], hostile)),
            source: 'system',
        })

        // 标签没被提前截断 ⇒ 正文边界正确。from-name 的原文不回填（转义后即最终文本），
        // 名字只给人看，身份由 from-session-id 承担
        expect(parsed?.text).toBe('body')
        expect(parsed?.fromName).toContain('&quot;hi&quot;')
    })

    it('读写两半是同一份格式：既有入站解析器能读回我们写的信封', () => {
        const parsed = parseInboundCrossSession({
            prompt: flatten(withCrossSessionEnvelope([{ type: 'text', text: 'hello there' }], envelope)),
            source: 'system',
        })

        // inboundCrossSession.ts 的 ENVELOPE_RE / FROM_NAME_RE 是读侧，本模块是写侧——
        // 两处漂移时这条会红（这正是把信封写成纯函数并放在解析器旁边的原因）
        expect(parsed).toEqual({ text: 'hello there', fromName: 'Sender', fromSessionId: 'A' })
    })
})
