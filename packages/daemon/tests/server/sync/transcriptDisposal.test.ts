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

/** 按路径形状分别报告 jsonl 与同名附属目录是否在场；remove 抛错可注入 */
function fakeFs(present: { file?: boolean; dir?: boolean }, removeThrows?: Error): TranscriptFsDeps & { removed: string[]; warnings: string[] } {
    const removed: string[] = []
    const warnings: string[] = []
    return {
        exists: (path: string) => (path.endsWith('.jsonl') ? Boolean(present.file) : Boolean(present.dir)),
        remove: (path) => {
            if (removeThrows) throw removeThrows
            removed.push(path)
        },
        warn: (message) => warnings.push(message),
        removed,
        warnings,
    }
}

describe('disposeTranscript', () => {
    it('四闸齐全 → jsonl 与同名附属目录一并删除', () => {
        const fs = fakeFs({ file: true, dir: true })
        const result = disposeTranscript('native-1', '/tmp/proj', true, fs)
        expect(result).toEqual({ deleted: true })
        expect(fs.removed).toHaveLength(2)
        expect(fs.removed[0]).toContain('native-1.jsonl')
        expect(fs.removed[1]).toContain('native-1')
        expect(fs.removed[1]).not.toContain('.jsonl')
    })

    it('文件本就不存在（未物化 fork）→ 按已删除口径，不报原因', () => {
        const fs = fakeFs({})
        const result = disposeTranscript('native-1', '/tmp/proj', true, fs)
        expect(result).toEqual({ deleted: true })
        expect(fs.removed).toHaveLength(0)
    })

    it('jsonl 缺失但附属目录在场 → 目录照删（同生同灭不留孤儿目录）', () => {
        const fs = fakeFs({ dir: true })
        const result = disposeTranscript('native-1', '/tmp/proj', true, fs)
        expect(result).toEqual({ deleted: true })
        expect(fs.removed).toHaveLength(1)
        expect(fs.removed[0]).not.toContain('.jsonl')
    })

    it('附属目录删除失败 → deleted 仍 true，降级为 warn 事实（对话本体已删净）', () => {
        const fs = fakeFs({ file: true, dir: true })
        const jsonlThrow = (path: string) => { if (!path.endsWith('.jsonl')) throw new Error('EBUSY') }
        const guarded: TranscriptFsDeps & { removed: string[]; warnings: string[] } = {
            ...fs,
            remove: (path) => { jsonlThrow(path); fs.remove(path) },
        }
        const result = disposeTranscript('native-1', '/tmp/proj', true, guarded)
        expect(result).toEqual({ deleted: true })
        expect(fs.removed).toHaveLength(1)
        expect(fs.warnings[0]).toContain('EBUSY')
    })

    it('CLI 未退出 → 保留并说明', () => {
        const fs = fakeFs({ file: true })
        const result = disposeTranscript('native-1', '/tmp/proj', false, fs)
        expect(result.deleted).toBe(false)
        expect(result.retainedReason).toContain('still running')
        expect(fs.removed).toHaveLength(0)
    })

    it('native id 缺失 → 保留并说明', () => {
        const fs = fakeFs({ file: true })
        const result = disposeTranscript(null, '/tmp/proj', true, fs)
        expect(result.deleted).toBe(false)
        expect(result.retainedReason).toContain('missing-native-session-id')
    })

    it('cwd 缺失 → 保留并说明', () => {
        const fs = fakeFs({ file: true })
        const result = disposeTranscript('native-1', null, true, fs)
        expect(result.deleted).toBe(false)
        expect(result.retainedReason).toContain('missing-working-directory')
    })

    it('删除抛错 → 保留并带回原因', () => {
        const fs = fakeFs({ file: true }, new Error('EBUSY'))
        const result = disposeTranscript('native-1', '/tmp/proj', true, fs)
        expect(result.deleted).toBe(false)
        expect(result.retainedReason).toContain('EBUSY')
    })
})
