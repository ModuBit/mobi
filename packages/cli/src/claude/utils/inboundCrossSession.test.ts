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

import { describe, expect, it } from 'vitest'
import { parseInboundCrossSession } from './inboundCrossSession'

const envelope = (fromName: string, body: string) =>
    `Another Claude session sent a message:\n<cross-session-message from="uds:/tmp/cc-socks/1.sock" from-name="${fromName}" from-mode="prompting">\n${body}\n</cross-session-message>\n\nThis came from another Claude session — not typed by your user.`

describe('parseInboundCrossSession', () => {
    it('信封 + source=system → 提取 from 与正文（剥离外壳文案）', () => {
        const r = parseInboundCrossSession({ prompt: envelope('mobi-ad', '晚上好'), source: 'system' })
        expect(r).toEqual({ text: '晚上好', fromName: 'mobi-ad' })
    })

    it('信封 + source 缺省（字段灰度期）→ 同样提取', () => {
        const r = parseInboundCrossSession({ prompt: envelope('mobi-05', 'ping') })
        expect(r).toEqual({ text: 'ping', fromName: 'mobi-05' })
    })

    it('source 为已知非 system（自己的 stdin push / loop 等）→ 恒忽略', () => {
        expect(parseInboundCrossSession({ prompt: envelope('mobi-ad', 'x'), source: 'sdk' })).toBeNull()
        expect(parseInboundCrossSession({ prompt: envelope('mobi-ad', 'x'), source: 'user' })).toBeNull()
        expect(parseInboundCrossSession({ prompt: envelope('mobi-ad', 'x'), source: 'loop_wakeup' })).toBeNull()
    })

    it('无信封 → 忽略（任务通知/auto-continuation 等机器注入不展示；自己的 push 不重复落库）', () => {
        expect(parseInboundCrossSession({ prompt: '你好', source: 'system' })).toBeNull()
        expect(parseInboundCrossSession({ prompt: '你好', source: 'sdk' })).toBeNull()
        expect(parseInboundCrossSession({ prompt: '你好' })).toBeNull()
    })

    it('信封缺 from-name 属性 → 降级：正文落库、from 为 null', () => {
        const prompt = 'prefix <cross-session-message from="uds:/tmp/x.sock">hello</cross-session-message> suffix'
        expect(parseInboundCrossSession({ prompt, source: 'system' })).toEqual({ text: 'hello', fromName: null })
    })

    it('开标签缺 from-name、正文引用别处 from-name 文本 → 不误提取，from 为 null', () => {
        const prompt = '<cross-session-message from="uds:/tmp/x.sock">他提到 from-name="evil" 这个名字</cross-session-message>'
        expect(parseInboundCrossSession({ prompt, source: 'system' }))
            .toEqual({ text: '他提到 from-name="evil" 这个名字', fromName: null })
    })

    it('正文多行保留原始换行（仅 trim 首尾）', () => {
        const r = parseInboundCrossSession({ prompt: envelope('a', 'line1\nline2') })
        expect(r?.text).toBe('line1\nline2')
    })
})
