import { describe, it, expect } from 'vitest'
import { resolveDragDisposition } from '@/components/ui/resolveDragDisposition'

describe('resolveDragDisposition（速度符号优先于位置——Apple 原则）', () => {
    const base = { height: 400 }
    it('快速下甩即关，哪怕位移很小', () => {
        expect(resolveDragDisposition({ ...base, offset: 20, velocity: 600 })).toBe('close')
    })
    it('快速上推回位，哪怕位移已过半', () => {
        expect(resolveDragDisposition({ ...base, offset: 250, velocity: -600 })).toBe('settle')
    })
    it('慢放：位移超过 sheet 高度 1/3 关闭', () => {
        expect(resolveDragDisposition({ ...base, offset: 140, velocity: 0 })).toBe('close')
        expect(resolveDragDisposition({ ...base, offset: 130, velocity: 0 })).toBe('settle')
    })
    it('边界：速度阈值 ±500 内按位置判', () => {
        expect(resolveDragDisposition({ ...base, offset: 100, velocity: 500 })).toBe('settle')
        expect(resolveDragDisposition({ ...base, offset: 100, velocity: -500 })).toBe('settle')
    })
})
