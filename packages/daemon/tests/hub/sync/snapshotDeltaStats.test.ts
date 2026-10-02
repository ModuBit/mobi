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

import { describe, test, expect } from 'bun:test'
import { SnapshotDeltaStats } from '../../src/sync/snapshotDeltaStats'

const fullPayload = { message: { content: { content: { data: { message: { content: [{ type: 'text', text: 'x'.repeat(400) }] } } } } } }
const deltaPayload = { localId: 'l1', rev: 3, baseRev: 2, deltas: [{ op: 'append', index: 0, text: 'xy' }] }

describe('SnapshotDeltaStats', () => {
    test('未开启时零记录（零开销路径）', () => {
        const stats = new SnapshotDeltaStats(false)
        stats.record('cli-to-hub', 'full', fullPayload)
        stats.record('hub-to-web', 'delta', deltaPayload)
        expect(stats.snapshot()).toEqual({
            'cli-to-hub': { fullFrames: 0, fullBytes: 0, deltaFrames: 0, deltaBytes: 0 },
            'hub-to-web': { fullFrames: 0, fullBytes: 0, deltaFrames: 0, deltaBytes: 0 },
        })
    })

    test('按段按类累计帧数与字节数', () => {
        const stats = new SnapshotDeltaStats(true)
        stats.record('cli-to-hub', 'full', fullPayload)
        stats.record('cli-to-hub', 'delta', deltaPayload)
        stats.record('hub-to-web', 'full', fullPayload)
        stats.record('hub-to-web', 'delta', deltaPayload)

        const fullBytes = JSON.stringify(fullPayload).length
        const deltaBytes = JSON.stringify(deltaPayload).length
        expect(stats.snapshot()).toEqual({
            'cli-to-hub': { fullFrames: 1, fullBytes, deltaFrames: 1, deltaBytes },
            'hub-to-web': { fullFrames: 1, fullBytes, deltaFrames: 1, deltaBytes },
        })
    })

    test('按间隔输出汇总日志（间隔内静默）', () => {
        const logs: string[] = []
        let clock = 0
        const stats = new SnapshotDeltaStats(true, 30_000, m => logs.push(m), () => clock)

        stats.record('cli-to-hub', 'delta', deltaPayload)
        expect(logs).toHaveLength(1) // 首次记录即输出基线

        clock = 10_000
        stats.record('cli-to-hub', 'delta', deltaPayload)
        expect(logs).toHaveLength(1) // 间隔内静默

        clock = 31_000
        stats.record('cli-to-hub', 'delta', deltaPayload)
        expect(logs).toHaveLength(2) // 越过间隔再输出
    })

    test('汇总单行含两段四类计数', () => {
        const stats = new SnapshotDeltaStats(true)
        stats.record('cli-to-hub', 'full', fullPayload)
        stats.record('cli-to-hub', 'delta', deltaPayload)
        stats.record('hub-to-web', 'full', fullPayload)
        stats.record('hub-to-web', 'delta', deltaPayload)

        const line = stats.summary()
        expect(line).toContain('cli→hub')
        expect(line).toContain('hub→web')
        expect(line).toContain('full 1 帧')
        expect(line).toContain('delta 1 帧')
    })
})
