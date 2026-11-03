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
 * transcript 处置的删除闸契约（session-retention 票 07）：断言返回值与删除调用，
 * 不断言文件系统细节（fs 假件注入）。
 */

import { describe, it, expect } from 'bun:test'
import { disposeTranscript, type TranscriptFsDeps } from '../../../src/sync/transcriptDisposal'

function fakeFs(exists: boolean, removeThrows?: Error): TranscriptFsDeps & { removed: string[] } {
    const removed: string[] = []
    return {
        exists: () => exists,
        remove: (path) => {
            if (removeThrows) throw removeThrows
            removed.push(path)
        },
        removed,
    }
}

describe('disposeTranscript', () => {
    it('四闸齐全 → 删除', () => {
        const fs = fakeFs(true)
        const result = disposeTranscript('native-1', '/tmp/proj', true, fs)
        expect(result).toEqual({ deleted: true })
        expect(fs.removed).toHaveLength(1)
        expect(fs.removed[0]).toContain('native-1.jsonl')
    })

    it('文件本就不存在（未物化 fork）→ 按已删除口径，不报原因', () => {
        const fs = fakeFs(false)
        const result = disposeTranscript('native-1', '/tmp/proj', true, fs)
        expect(result).toEqual({ deleted: true })
        expect(fs.removed).toHaveLength(0)
    })

    it('CLI 未退出 → 保留并说明', () => {
        const fs = fakeFs(true)
        const result = disposeTranscript('native-1', '/tmp/proj', false, fs)
        expect(result.deleted).toBe(false)
        expect(result.retainedReason).toContain('still running')
        expect(fs.removed).toHaveLength(0)
    })

    it('native id 缺失 → 保留并说明', () => {
        const fs = fakeFs(true)
        const result = disposeTranscript(null, '/tmp/proj', true, fs)
        expect(result.deleted).toBe(false)
        expect(result.retainedReason).toContain('missing-native-session-id')
    })

    it('cwd 缺失 → 保留并说明', () => {
        const fs = fakeFs(true)
        const result = disposeTranscript('native-1', null, true, fs)
        expect(result.deleted).toBe(false)
        expect(result.retainedReason).toContain('missing-working-directory')
    })

    it('删除抛错 → 保留并带回原因', () => {
        const fs = fakeFs(true, new Error('EBUSY'))
        const result = disposeTranscript('native-1', '/tmp/proj', true, fs)
        expect(result.deleted).toBe(false)
        expect(result.retainedReason).toContain('EBUSY')
    })
})
