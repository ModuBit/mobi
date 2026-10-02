import { describe, it, expect } from 'vitest'
import { CompactStartGate } from '../../../src/claude/utils/compactLifecycle'

describe('CompactStartGate', () => {
    it('首次 shouldEmit 为 true，同一次压缩内重复触发被吞（手动 specialCommand 与 status 双源幂等）', () => {
        const gate = new CompactStartGate()
        expect(gate.shouldEmit()).toBe(true)
        expect(gate.shouldEmit()).toBe(false)
        expect(gate.shouldEmit()).toBe(false)
    })

    it('终态 reset 后下一次压缩可重新触发', () => {
        const gate = new CompactStartGate()
        gate.shouldEmit()
        gate.reset()
        expect(gate.shouldEmit()).toBe(true)
    })
})
