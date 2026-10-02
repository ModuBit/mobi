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
import { evaluateDormancyGate, type DormancyFacts } from '@/claude/utils/dormancyGate'

const CLEAR: DormancyFacts = {
    pendingPermissions: 0,
    queuedMessages: 0,
    turnRunning: false,
    liveTerminals: 0,
    backgroundTasks: 0,
}

describe('evaluateDormancyGate', () => {
    it('五项全清 → 放行', () => {
        expect(evaluateDormancyGate(CLEAR)).toEqual({ ok: true, blockers: [] })
    })

    it.each([
        ['pending_permissions', { ...CLEAR, pendingPermissions: 1 }],
        ['queued_messages', { ...CLEAR, queuedMessages: 2 }],
        ['turn_running', { ...CLEAR, turnRunning: true }],
        ['live_terminals', { ...CLEAR, liveTerminals: 1 }],
        ['background_tasks', { ...CLEAR, backgroundTasks: 3 }],
    ] as const)('%s 单项阻塞', (blocker, facts) => {
        expect(evaluateDormancyGate(facts)).toEqual({ ok: false, blockers: [blocker] })
    })

    it('多项并发阻塞 → blockers 全量列出（手动休眠反馈需要逐项文案）', () => {
        const r = evaluateDormancyGate({ ...CLEAR, pendingPermissions: 1, liveTerminals: 2, backgroundTasks: 1 })
        expect(r.ok).toBe(false)
        expect(r.blockers).toEqual(['pending_permissions', 'live_terminals', 'background_tasks'])
    })
})
