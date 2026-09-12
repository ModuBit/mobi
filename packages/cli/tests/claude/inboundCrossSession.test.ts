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
import { classifyInboundTurn } from '@/claude/utils/inboundCrossSession'

describe('classifyInboundTurn', () => {
    const peerEnvelope = '<cross-session-message from-name="demo-6d">hello</cross-session-message>'

    it('peer: source=system + 信封 → kind=peer, from=from-name', () => {
        const r = classifyInboundTurn({ prompt: peerEnvelope, source: 'system' })
        expect(r).toEqual({ kind: 'peer', text: 'hello', fromName: 'demo-6d' })
    })

    it('scheduled: source=schedule_wakeup → kind=scheduled, from=null, text=prompt', () => {
        const r = classifyInboundTurn({ prompt: 'check the build', source: 'schedule_wakeup' })
        expect(r).toEqual({ kind: 'scheduled', text: 'check the build', fromName: null })
    })

    it('loop: source=loop_wakeup → kind=loop, from=null', () => {
        const r = classifyInboundTurn({ prompt: 'continue the loop', source: 'loop_wakeup' })
        expect(r).toEqual({ kind: 'loop', text: 'continue the loop', fromName: null })
    })

    it('null: mobi 自发投递的信封（带 from-session-id）→ 不重复落库', () => {
        // 投递路径自己落库，观测路径再记一次会在目标会话里留两行一模一样的消息
        // （2026-09-12 E2E 实测两行相隔 15ms）
        const mobiEnvelope =
            '<cross-session-message from-name="A" from-session-id="sess-a" message-id="m1">hello</cross-session-message>'
        expect(classifyInboundTurn({ prompt: mobiEnvelope, source: 'system' })).toBeNull()
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
