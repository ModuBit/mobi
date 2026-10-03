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
import {
    applySessionTrackingSignal,
    pruneDeadTrackedSessions,
    type SessionTrackingSignal,
} from '@/runner/sessionTracking'
import type { TrackedSession } from '@/runner/types'

function makeMap(entries: Array<[number, TrackedSession]>): Map<number, TrackedSession> {
    return new Map(entries)
}

const alive = (_pid: number) => true
const dead = (_pid: number) => false

describe('applySessionTrackingSignal — 补登（daemon 重启后恢复追踪表）', () => {
    it('表无该会话且 pid 存活 → backfill 新表项（带 resumeSessionId 查重键）', () => {
        const map = makeMap([])
        const signal: SessionTrackingSignal = {
            sessionId: 'sess-1',
            hostPid: 4242,
            nativeSessionId: 'native-aaa',
            startedBy: 'runner',
        }
        const result = applySessionTrackingSignal(map, signal, alive)

        expect(result.op).toBe('backfill')
        const entry = map.get(4242)
        expect(entry).toMatchObject({
            MobiSessionId: 'sess-1',
            pid: 4242,
            resumeSessionId: 'native-aaa',
        })
    })

    it('无 hostPid → skip no-pid，不动表', () => {
        const map = makeMap([])
        const result = applySessionTrackingSignal(map, { sessionId: 'sess-1' }, alive)
        expect(result).toEqual({ op: 'skip', reason: 'no-pid' })
        expect(map.size).toBe(0)
    })

    it('pid 已死 → skip pid-dead（pid 复用防护：不登死 pid）', () => {
        const map = makeMap([])
        const result = applySessionTrackingSignal(map, { sessionId: 's', hostPid: 1, nativeSessionId: 'n' }, dead)
        expect(result).toEqual({ op: 'skip', reason: 'pid-dead' })
        expect(map.size).toBe(0)
    })

    it('pid 已被其他会话占用 → skip pid-collision（不覆盖他人表项）', () => {
        const map = makeMap([[4242, { startedBy: 'runner', pid: 4242, MobiSessionId: 'other' }]])
        const result = applySessionTrackingSignal(map, { sessionId: 'sess-1', hostPid: 4242, nativeSessionId: 'n' }, alive)
        expect(result).toEqual({ op: 'skip', reason: 'pid-collision' })
        expect(map.get(4242)?.MobiSessionId).toBe('other')
    })
})

describe('applySessionTrackingSignal — 刷新（查重键随 nativeSessionId 演进）', () => {
    it('表项已存在（按 sessionId 命中）→ 刷新 resumeSessionId 为当前 nativeSessionId（/clear、fork 换链后）', () => {
        const map = makeMap([[4242, { startedBy: 'runner', pid: 4242, MobiSessionId: 'sess-1', resumeSessionId: 'native-old' }]])
        const result = applySessionTrackingSignal(map, { sessionId: 'sess-1', hostPid: 4242, nativeSessionId: 'native-new' }, alive)

        expect(result).toEqual({ op: 'refresh', pid: 4242, resumeSessionId: 'native-new' })
        expect(map.get(4242)?.resumeSessionId).toBe('native-new')
    })

    it('刷新不依赖 hostPid 与存活判定（在册表项的存活由既有清理保证）', () => {
        const map = makeMap([[4242, { startedBy: 'terminal', pid: 4242, MobiSessionId: 'sess-1' }]])
        const result = applySessionTrackingSignal(map, { sessionId: 'sess-1', nativeSessionId: 'native-x' }, dead)
        expect(result.op).toBe('refresh')
        expect(map.get(4242)?.resumeSessionId).toBe('native-x')
    })

    it('nativeSessionId 为空 → 刷新为 undefined（表项退出查重）', () => {
        const map = makeMap([[4242, { startedBy: 'runner', pid: 4242, MobiSessionId: 'sess-1', resumeSessionId: 'native-old' }]])
        const result = applySessionTrackingSignal(map, { sessionId: 'sess-1', nativeSessionId: null }, alive)
        expect(result).toEqual({ op: 'refresh', pid: 4242, resumeSessionId: undefined })
        expect(map.get(4242)?.resumeSessionId).toBeUndefined()
    })
})

describe('pruneDeadTrackedSessions — pid 退出清理（非子进程表项）', () => {
    it('清除死 pid 表项，保留活表项', () => {
        const map = makeMap([
            [1, { startedBy: 'runner', pid: 1 }],
            [2, { startedBy: 'backfill', pid: 2, MobiSessionId: 'sess-2' }],
        ])
        const pruned = pruneDeadTrackedSessions(map, (pid) => pid !== 1) // pid 1 已死
        expect(pruned).toEqual([1])
        expect(map.has(2)).toBe(true)
        expect(map.size).toBe(1)
    })
})
