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
import { classifyInboundTurn, parseInboundCrossSession } from '@/claude/utils/inboundCrossSession'

/** CC 原生信封：只有 from / from-name / from-mode 三个属性 */
const envelope = (fromName: string, body: string) =>
    `Another Claude session sent a message:\n<cross-session-message from="uds:/tmp/cc-socks/1.sock" from-name="${fromName}" from-mode="prompting">\n${body}\n</cross-session-message>\n\nThis came from another Claude session — not typed by your user.`

/** mobi 自发投递的信封：多一个 from-session-id（mobi 加的，见 crossSessionEnvelope.ts） */
const mobiEnvelope = (body: string) =>
    `<cross-session-message from-name="A" from-session-id="sess-a" message-id="m1">${body}</cross-session-message>`

/** 带**空** from-session-id 的信封（手打/伪造；CC 与 mobi 都不会产出它） */
const emptyIdEnvelope = (body: string) =>
    `<cross-session-message from-name="A" from-session-id="" message-id="m1">${body}</cross-session-message>`

describe('parseInboundCrossSession（信封 → 来源身份）', () => {
    it('信封 + source=system → 剥掉外壳文案，来源归一到 CrossSessionOrigin 的形状', () => {
        expect(parseInboundCrossSession({ prompt: envelope('mobi-ad', '晚上好'), source: 'system' }))
            .toEqual({ text: '晚上好', origin: { fromName: 'mobi-ad', fromSessionId: null } })
    })

    it('信封 + source 缺省（字段灰度期）→ 同样提取', () => {
        const r = parseInboundCrossSession({ prompt: envelope('mobi-05', 'ping') })
        expect(r).toEqual({ text: 'ping', origin: { fromName: 'mobi-05', fromSessionId: null } })
    })

    it('信封带 from-session-id（mobi 自发投递的信封）→ 一并提取出来', () => {
        expect(parseInboundCrossSession({ prompt: mobiEnvelope('hi'), source: 'system' }))
            .toEqual({ text: 'hi', origin: { fromName: 'A', fromSessionId: 'sess-a' } })
    })

    it('信封带**空**的 from-session-id → 归 null（空串带不了身份）', () => {
        // 放行空串，isMobiDelivered 会读成「mobi 投递过」，这条真的 peer turn 就被观测路径
        // 丢掉（既不落库也不上 Web）。规则收在 shared 的 normalizeFromSessionId
        expect(parseInboundCrossSession({ prompt: emptyIdEnvelope('hi'), source: 'system' }))
            .toEqual({ text: 'hi', origin: { fromName: 'A', fromSessionId: null } })
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

    it('信封缺 from-name 属性 → 降级：正文仍提取，名字为空串（空名字不等于没有来源）', () => {
        const prompt = 'prefix <cross-session-message from="uds:/tmp/x.sock">hello</cross-session-message> suffix'
        expect(parseInboundCrossSession({ prompt, source: 'system' }))
            .toEqual({ text: 'hello', origin: { fromName: '', fromSessionId: null } })
    })

    it('开标签缺 from-name、正文引用别处 from-name 文本 → 不误提取正文内容', () => {
        const prompt = '<cross-session-message from="uds:/tmp/x.sock">他提到 from-name="evil" 这个名字</cross-session-message>'
        expect(parseInboundCrossSession({ prompt, source: 'system' }))
            .toEqual({ text: '他提到 from-name="evil" 这个名字', origin: { fromName: '', fromSessionId: null } })
    })

    it('正文多行保留原始换行（仅 trim 首尾）', () => {
        const r = parseInboundCrossSession({ prompt: envelope('a', 'line1\nline2') })
        expect(r?.text).toBe('line1\nline2')
    })
})

describe('classifyInboundTurn（入站 turn 甄别）', () => {
    it('peer: source=system + 信封 → kind=peer，来源身份带出来', () => {
        const r = classifyInboundTurn({ prompt: envelope('demo-6d', 'hello'), source: 'system' })
        expect(r).toEqual({ kind: 'peer', text: 'hello', origin: { fromName: 'demo-6d', fromSessionId: null } })
    })

    it('scheduled: source=schedule_wakeup → kind=scheduled，无来源（不是别的会话发来的）', () => {
        const r = classifyInboundTurn({ prompt: 'check the build', source: 'schedule_wakeup' })
        expect(r).toEqual({ kind: 'scheduled', text: 'check the build', origin: null })
    })

    it('loop: source=loop_wakeup → kind=loop，无来源', () => {
        const r = classifyInboundTurn({ prompt: 'continue the loop', source: 'loop_wakeup' })
        expect(r).toEqual({ kind: 'loop', text: 'continue the loop', origin: null })
    })

    it('null: mobi 自发投递的信封（带 from-session-id）→ 不重复落库', () => {
        // 投递路径自己落库，观测路径再记一次会在目标会话里留两行一模一样的消息
        // （2026-09-12 E2E 实测两行相隔 15ms）。判据与 backfill 守卫、hub 的 sendMessage
        // 回灌判据是同一个（shared 的 isMobiDelivered）——信封读侧归一成与 meta 同一形状，
        // 故这句与那一侧问的正是同一句话
        expect(classifyInboundTurn({ prompt: mobiEnvelope('hello'), source: 'system' })).toBeNull()
    })

    it('peer: 信封带空的 from-session-id（非规范取值）→ 仍按 peer 落库', () => {
        // 只有「非空 id」才等于 mobi 投递过；空串按「没有 id」算，这条 turn 该照常落库
        expect(classifyInboundTurn({ prompt: emptyIdEnvelope('hello'), source: 'system' }))
            .toEqual({ kind: 'peer', text: 'hello', origin: { fromName: 'A', fromSessionId: null } })
    })

    it('null: source=user（交互）→ 不落库', () => {
        expect(classifyInboundTurn({ prompt: 'hi', source: 'user' })).toBeNull()
    })

    it('null: source=system 但无信封 → 非 peer，不落库', () => {
        expect(classifyInboundTurn({ prompt: 'auto-continuation', source: 'system' })).toBeNull()
    })

    it('null: source=sdk → 不落库', () => {
        expect(classifyInboundTurn({ prompt: '-p entry', source: 'sdk' })).toBeNull()
    })
})
