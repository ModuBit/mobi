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

import { describe, it, expect, vi } from 'vitest'
import { reportRewindCompletion, type RewindReportClient } from '../../../src/claude/utils/rewindReport'
import type { PendingRewind } from '../../../src/claude/types'

vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

function makeClient(): RewindReportClient & { emitRewindCompleted: ReturnType<typeof vi.fn> } {
    return {
        fetchRewindBoundary: vi.fn().mockResolvedValue(5),
        emitRewindTruncated: vi.fn(),
        emitRewindCompleted: vi.fn(),
    } as unknown as RewindReportClient & { emitRewindCompleted: ReturnType<typeof vi.fn> }
}

describe('reportRewindCompletion', () => {
    it('skippedLinks 透传到 emitRewindCompleted（spec E2）', async () => {
        const client = makeClient()
        const rewind: PendingRewind = {
            nativeId: 'n1',
            resumeAt: 'a1',
            filesRestored: true,
            skippedLinks: 3,
        }
        await reportRewindCompletion(client, rewind)
        expect(client.emitRewindCompleted).toHaveBeenCalledWith(true, undefined, 3)
    })

    it('skippedLinks 未设置时传 undefined（兼容旧路径）', async () => {
        const client = makeClient()
        const rewind: PendingRewind = {
            nativeId: 'n1',
            resumeAt: 'a1',
            filesRestored: false,
        }
        await reportRewindCompletion(client, rewind)
        expect(client.emitRewindCompleted).toHaveBeenCalledWith(false, undefined, undefined)
    })
})
