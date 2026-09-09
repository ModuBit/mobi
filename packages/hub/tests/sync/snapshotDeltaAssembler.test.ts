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

import { describe, it, expect } from 'bun:test'
import { SnapshotDeltaAssembler } from '../../src/sync/snapshotDeltaAssembler'
import type { SnapshotDeltaFrame, SnapshotBlock } from '@mobi/shared'
import { envelope, blocksOf } from '../helpers/snapshotDelta'

function delta(localId: string, rev: number, baseRev: number, deltas: SnapshotDeltaFrame['deltas']): SnapshotDeltaFrame {
    return { localId, rev, baseRev, deltas }
}

describe('SnapshotDeltaAssembler - 全量帧与增量拼接', () => {
    it('全量帧建缓存并原样返回；衔接的 append delta 拼接到对应块', () => {
        const asm = new SnapshotDeltaAssembler()
        const full = asm.applyFull('s1', 'u1', envelope([{ type: 'text', text: 'hel' }]), 1)
        expect(full).not.toBeNull()

        const out = asm.applyDelta('s1', delta('u1', 2, 1, [{ op: 'append', index: 0, text: 'lo' }]))
        expect(out).not.toBeNull()
        expect(blocksOf(out)).toEqual([{ type: 'text', text: 'hello' }])
    })

    it('append 作用于 thinking 块的 thinking 字段', () => {
        const asm = new SnapshotDeltaAssembler()
        asm.applyFull('s1', 'u1', envelope([{ type: 'thinking', thinking: 'th' }]), 1)

        const out = asm.applyDelta('s1', delta('u1', 2, 1, [{ op: 'append', index: 0, text: 'ink' }]))
        expect(blocksOf(out)).toEqual([{ type: 'thinking', thinking: 'think' }])
    })

    it('new-block 追加新块（tool_use 占位）；replace-block 整块替换（ready 翻转 / done 标记）', () => {
        const asm = new SnapshotDeltaAssembler()
        asm.applyFull('s1', 'u1', envelope([{ type: 'text', text: 'hi' }]), 1)

        let out = asm.applyDelta('s1', delta('u1', 2, 1, [
            { op: 'new-block', index: 1, block: { type: 'tool_use', id: 't1', name: 'Bash', input: {} } },
        ]))
        expect(blocksOf(out)).toEqual([
            { type: 'text', text: 'hi' },
            { type: 'tool_use', id: 't1', name: 'Bash', input: {} },
        ])

        out = asm.applyDelta('s1', delta('u1', 3, 2, [
            { op: 'replace-block', index: 1, block: { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } } },
        ]))
        expect(blocksOf(out)).toEqual([
            { type: 'text', text: 'hi' },
            { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
        ])

        out = asm.applyDelta('s1', delta('u1', 4, 3, [
            { op: 'replace-block', index: 0, block: { type: 'thinking', thinking: 'x', durationMs: 9, done: true } },
        ]))
        expect(blocksOf(out)[0]).toEqual({ type: 'thinking', thinking: 'x', durationMs: 9, done: true })
    })

    it('同帧多 op 按序应用（append + new-block）', () => {
        const asm = new SnapshotDeltaAssembler()
        asm.applyFull('s1', 'u1', envelope([{ type: 'text', text: 'a' }]), 1)

        const out = asm.applyDelta('s1', delta('u1', 2, 1, [
            { op: 'append', index: 0, text: 'b' },
            { op: 'new-block', index: 1, block: { type: 'text', text: 'c' } },
        ]))
        expect(blocksOf(out)).toEqual([{ type: 'text', text: 'ab' }, { type: 'text', text: 'c' }])
    })

    it('多个消息流并存：按 (sid, localId) 独立缓存', () => {
        const asm = new SnapshotDeltaAssembler()
        asm.applyFull('s1', 'u1', envelope([{ type: 'text', text: 'one' }]), 1)
        asm.applyFull('s1', 'u2', envelope([{ type: 'text', text: 'two' }]), 5)

        const out1 = asm.applyDelta('s1', delta('u1', 2, 1, [{ op: 'append', index: 0, text: '!' }]))
        const out2 = asm.applyDelta('s1', delta('u2', 6, 5, [{ op: 'append', index: 0, text: '?' }]))
        expect(blocksOf(out1)[0]).toEqual({ type: 'text', text: 'one!' })
        expect(blocksOf(out2)[0]).toEqual({ type: 'text', text: 'two?' })
    })
})

describe('SnapshotDeltaAssembler - 断档与违规（丢弃优于错乱）', () => {
    it('baseRev 不衔接 → 返回 null 且缓存被删，后续 delta 持续 null 直到全量帧恢复', () => {
        const asm = new SnapshotDeltaAssembler()
        asm.applyFull('s1', 'u1', envelope([{ type: 'text', text: 'a' }]), 1)

        // 断档（期望 1，实收 baseRev=3）
        expect(asm.applyDelta('s1', delta('u1', 4, 3, [{ op: 'append', index: 0, text: 'x' }]))).toBeNull()
        // 后续衔接 4 的 delta 也无法恢复（缓存已删）
        expect(asm.applyDelta('s1', delta('u1', 5, 4, [{ op: 'append', index: 0, text: 'y' }]))).toBeNull()
        // 全量帧恢复
        const out = asm.applyFull('s1', 'u1', envelope([{ type: 'text', text: 'fresh' }]), 10)
        expect(out).not.toBeNull()
        expect(asm.applyDelta('s1', delta('u1', 11, 10, [{ op: 'append', index: 0, text: '!' }]))).not.toBeNull()
    })

    it('无缓存时收到 delta → null（不凭空拼接）', () => {
        const asm = new SnapshotDeltaAssembler()
        expect(asm.applyDelta('s1', delta('u1', 1, 0, [{ op: 'append', index: 0, text: 'x' }]))).toBeNull()
    })

    it('违规 op：append 到 tool_use 块 → null 且缓存删（丢弃优于错乱）', () => {
        const asm = new SnapshotDeltaAssembler()
        asm.applyFull('s1', 'u1', envelope([{ type: 'tool_use', id: 't', name: 'Bash', input: {} }]), 1)
        expect(asm.applyDelta('s1', delta('u1', 2, 1, [{ op: 'append', index: 0, text: 'x' }]))).toBeNull()
        // 缓存已删：后续合法 delta 也 null
        expect(asm.applyDelta('s1', delta('u1', 3, 2, []))).toBeNull()
    })

    it('违规 op：new-block 到非末位 / replace-block 越界 → null 且缓存删', () => {
        const asm = new SnapshotDeltaAssembler()
        asm.applyFull('s1', 'u1', envelope([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 1)
        expect(asm.applyDelta('s1', delta('u1', 2, 1, [
            { op: 'new-block', index: 0, block: { type: 'text', text: 'x' } },
        ]))).toBeNull()

        asm.applyFull('s1', 'u2', envelope([{ type: 'text', text: 'a' }]), 1)
        expect(asm.applyDelta('s1', delta('u2', 2, 1, [
            { op: 'replace-block', index: 5, block: { type: 'text', text: 'x' } },
        ]))).toBeNull()
    })

    it('legacy 全量（rev=null，老 CLI）建无链缓存：透传返回内容，delta 因无链被拒', () => {
        const asm = new SnapshotDeltaAssembler()
        const content = envelope([{ type: 'text', text: 'legacy' }])
        expect(asm.applyFull('s1', 'u1', content, null)).toBe(content)
        // 老 CLI 不会发 delta；此断言锁定「legacy 无链不拼接」的防御语义
        expect(asm.applyDelta('s1', delta('u1', 1, 0, [{ op: 'append', index: 0, text: 'x' }]))).toBeNull()
    })

    it('信封形状不可导航的全量 → 不建缓存但原样透传返回（回退 legacy 直通）', () => {
        const asm = new SnapshotDeltaAssembler()
        const weird = { role: 'agent', content: { type: 'text', text: '非 output 信封' } }
        expect(asm.applyFull('s1', 'u1', weird, 1)).toBe(weird)
        expect(asm.applyDelta('s1', delta('u1', 2, 1, [{ op: 'append', index: 0, text: 'x' }]))).toBeNull()
    })
})

describe('SnapshotDeltaAssembler - 生命周期', () => {
    it('cleanupMessage：full message 落库后按 localId 清理，delta 不再命中', () => {
        const asm = new SnapshotDeltaAssembler()
        asm.applyFull('s1', 'u1', envelope([{ type: 'text', text: 'done' }]), 1)
        asm.cleanupMessage('s1', 'u1')
        expect(asm.applyDelta('s1', delta('u1', 2, 1, [{ op: 'append', index: 0, text: 'x' }]))).toBeNull()
    })

    it('cleanupSession：CLI socket 断开时清整个会话的缓存', () => {
        const asm = new SnapshotDeltaAssembler()
        asm.applyFull('s1', 'u1', envelope([{ type: 'text', text: 'a' }]), 1)
        asm.applyFull('s1', 'u2', envelope([{ type: 'text', text: 'b' }]), 1)
        asm.cleanupSession('s1')
        expect(asm.applyDelta('s1', delta('u1', 2, 1, []))).toBeNull()
        expect(asm.applyDelta('s1', delta('u2', 2, 1, []))).toBeNull()
    })

    it('TTL：超时条目在下次 apply 时被惰性清理（可注入时钟）', () => {
        let now = 1_000_000
        const asm = new SnapshotDeltaAssembler({ ttlMs: 60_000, now: () => now })
        asm.applyFull('s1', 'u1', envelope([{ type: 'text', text: 'a' }]), 1)

        now += 61_000
        // 任意一次 apply 触发惰性 sweep：过期条目被清，delta 落空
        asm.applyFull('s2', 'u9', envelope([{ type: 'text', text: 'b' }]), 1)
        expect(asm.applyDelta('s1', delta('u1', 2, 1, [{ op: 'append', index: 0, text: 'x' }]))).toBeNull()
    })
})
