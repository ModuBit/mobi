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
 * SessionGovernor（迭代二票 2.1）的测试面：cap 公式、acquireSlot 授予/yield、
 * in-flight 记账与 release 自愈。借鉴 Claude Desktop CliGovernor（asar 实锤见
 * .scratch/session-lifecycle-rewrite/notes.md），映射到 mobi 两级拓扑后治理面
 * 全在 daemon——本测试只锁纯记账行为，不接线任何真实数据源。
 */

import { describe, it, expect } from 'vitest'
import { SessionGovernor, computeDefaultCap, MIN_SESSION_CAP } from '@/executor/sessionGovernor'

const GIB = 1024 ** 3

function makeGovernor(overrides: {
    activeCount?: number
    totalmem?: number
    capOverride?: number | undefined
} = {}) {
    let activeCount = overrides.activeCount ?? 0
    const events: Array<Record<string, unknown>> = []
    const governor = new SessionGovernor({
        getActiveCount: () => activeCount,
        totalmem: overrides.totalmem ?? 16 * GIB,
        getCapOverride: () => overrides.capOverride,
        onEvent: (event) => { events.push(event as unknown as Record<string, unknown>) },
    })
    return {
        governor,
        events,
        setActiveCount: (n: number) => { activeCount = n },
    }
}

describe('computeDefaultCap（Desktop 同款公式）', () => {
    it('max(6, floor(totalmem / 3GiB))：16GB 机 = 6', () => {
        expect(computeDefaultCap(16 * GIB)).toBe(6)
    })

    it('32GB = 10、64GB = 21', () => {
        expect(computeDefaultCap(32 * GIB)).toBe(10)
        expect(computeDefaultCap(64 * GIB)).toBe(21)
    })

    it('小内存机下限钳到 6（8GB → 2 被钳）', () => {
        expect(computeDefaultCap(8 * GIB)).toBe(6)
        expect(MIN_SESSION_CAP).toBe(6)
    })
})

describe('acquireSlot 授予与记账', () => {
    it('低于 cap 授予；effective = active + inFlight', () => {
        const { governor } = makeGovernor({ activeCount: 2 })
        expect(governor.cap).toBe(6)
        expect(governor.effective).toBe(2)

        const slot = governor.acquireSlot('user')
        expect(slot.granted).toBe(true)
        expect(governor.effective).toBe(3)
    })

    it('release 归还 in-flight 名额（幂等）', () => {
        const { governor } = makeGovernor()
        const slot = governor.acquireSlot('user')
        expect(slot.granted).toBe(true)
        if (!slot.granted) return

        slot.release()
        expect(governor.effective).toBe(0)
        slot.release() // 幂等：重复 release 不多还
        expect(governor.effective).toBe(0)
    })

    it('active 自愈源变化（进程退出/ prune）即时反映', () => {
        const { governor, setActiveCount } = makeGovernor({ activeCount: 6 })
        const slot = governor.acquireSlot('user')
        expect(slot.granted).toBe(false) // 6/6 到顶

        setActiveCount(4) // 两个会话进程退场
        expect(governor.effective).toBe(4)
        expect(governor.acquireSlot('user').granted).toBe(true)
    })
})

describe('到顶 yield（硬上限不破）', () => {
    it('同步连发不超发：cap=6 时第 7 个 acquire yield（互斥闸无竞态）', () => {
        const { governor, events } = makeGovernor({ activeCount: 0 })
        const slots = Array.from({ length: 7 }, () => governor.acquireSlot('user'))
        expect(slots.filter((s) => s.granted).length).toBe(6)
        expect(slots[6].granted).toBe(false)
        // 全程 effective 不曾超过 cap（判定与登记同一同步块，无 await 穿插）
        expect(governor.effective).toBe(6)

        // yield 遥测：governor_yielded 带水位快照
        expect(events.at(-1)).toMatchObject({ type: 'governor_yielded', reason: 'user', effective: 6, cap: 6 })
    })

    it('yield 后释放一个名额即可再次授予', () => {
        const { governor } = makeGovernor({ activeCount: 5 })
        const slot = governor.acquireSlot('user')
        expect(slot.granted).toBe(true)
        expect(governor.acquireSlot('user').granted).toBe(false)

        if (slot.granted) slot.release()
        expect(governor.acquireSlot('user').granted).toBe(true)
    })

    it('in-flight 到顶同样 yield（active=0 全在途也受 cap 约束）', () => {
        const { governor } = makeGovernor({ activeCount: 0 })
        for (let i = 0; i < 6; i++) {
            expect(governor.acquireSlot('user').granted).toBe(true)
        }
        expect(governor.acquireSlot('user').granted).toBe(false)
    })
})

describe('cap 覆盖（settings.sessionGovernor.maxActive）', () => {
    it('override 生效且同样钳下限 6（热调 = getter 现读）', () => {
        const { governor } = makeGovernor({ capOverride: 10 })
        expect(governor.cap).toBe(10)

        const small = makeGovernor({ capOverride: 2 })
        expect(small.governor.cap).toBe(6)
    })

    it('override 撤销回落公式默认值', () => {
        let override: number | undefined = 12
        const governor = new SessionGovernor({
            getActiveCount: () => 0,
            totalmem: 32 * GIB,
            getCapOverride: () => override,
        })
        expect(governor.cap).toBe(12)
        override = undefined
        expect(governor.cap).toBe(10)
    })
})

// ============ 票 2.2：LRU 逐出 + 内存分级 ============

import { pickLruIdleVictim, DEFAULT_MIN_VICTIM_IDLE_MS, type GovernorCandidate } from '@/executor/sessionGovernor'

const NOW = 1_000_000
const IDLE_SINCE = NOW - DEFAULT_MIN_VICTIM_IDLE_MS - 1 // 恰好闲够了

function makeEvictGovernor(overrides: {
    candidates?: Array<{ sessionId: string; state?: 'active' | 'idle'; lastActivityAt?: number; gateBlockers?: string[] }>
    activeCount?: number
    evictResult?: boolean
} = {}) {
    let activeCount = overrides.activeCount ?? 6
    const evicted: string[] = []
    const events: Array<Record<string, unknown>> = []
    const governor = new SessionGovernor({
        getActiveCount: () => activeCount,
        totalmem: 16 * GIB, // cap 6
        onEvent: (event) => { events.push(event as unknown as Record<string, unknown>) },
        getGovernedSessions: () => (overrides.candidates ?? []).map((c) => ({
            sessionId: c.sessionId,
            state: c.state ?? 'idle',
            lastActivityAt: c.lastActivityAt ?? IDLE_SINCE,
            gateBlockers: c.gateBlockers ?? [],
        })),
        evictSession: async (sessionId) => {
            evicted.push(sessionId)
            if (overrides.evictResult === false) return false
            await Promise.resolve() // 模拟进程退场的异步窗口
            activeCount -= 1 // 逐出成功 → active 自愈源下降
            return true
        },
        now: () => NOW,
    })
    return { governor, evicted, events }
}

describe('pickLruIdleVictim（受害者选择纯函数）', () => {
    const c = (sessionId: string, lastActivityAt: number, extra: Partial<GovernorCandidate> = {}): GovernorCandidate => ({
        sessionId, state: 'idle', lastActivityAt, gateBlockers: [], ...extra,
    })

    it('取 lastActivityAt 最小（最久未活动）的合格者', () => {
        const victim = pickLruIdleVictim([c('a', NOW - 500), c('b', NOW - 999_999), c('d', NOW - 100)], NOW)
        expect(victim).toBe('b')
    })

    it('闲不够久（< minVictimIdleMs）不可逐', () => {
        expect(pickLruIdleVictim([c('a', NOW - DEFAULT_MIN_VICTIM_IDLE_MS + 1)], NOW)).toBeNull()
    })

    it('turn 运行中（state=active）与 gateBlockers 非空者跳过', () => {
        expect(pickLruIdleVictim([c('a', IDLE_SINCE, { state: 'active' })], NOW)).toBeNull()
        expect(pickLruIdleVictim([c('a', IDLE_SINCE, { gateBlockers: ['queued_messages'] })], NOW)).toBeNull()
    })

    it('无合格受害者返回 null', () => {
        expect(pickLruIdleVictim([], NOW)).toBeNull()
    })
})

describe('user 到顶触发逐出（票 2.2）', () => {
    it('逐出 LRU 空闲者并立即授予（evicting 从 effective 扣除，硬上限不破）', async () => {
        const { governor, evicted, events } = makeEvictGovernor({
            candidates: [{ sessionId: 'old-1' }, { sessionId: 'old-2', lastActivityAt: NOW - 10 }],
        })
        const slot = governor.acquireSlot('user')
        expect(slot.granted).toBe(true)      // 逐出腾位后授予
        expect(evicted).toEqual(['old-1'])   // old-1 更久未活动
        // evicting 已扣除 + inFlight 已登记：effective 仍是 cap
        expect(governor.effective).toBe(6)
        await Promise.resolve() // 微任务让逐出 promise 推进（activeCount 下降）
        await Promise.resolve()
        expect(governor.acquireSlot('user').granted).toBe(true) // 6-1=5 < cap：名额已腾出
        expect(events.some((e) => e.type === 'governor_evicting')).toBe(true)
    })

    it('无合格受害者（全在 turn 中/闲不够久）→ 仍 yield', () => {
        const { governor, evicted } = makeEvictGovernor({
            candidates: [{ sessionId: 'busy', state: 'active' }],
        })
        expect(governor.acquireSlot('user').granted).toBe(false)
        expect(evicted).toEqual([])
    })

    it('warm/prewarm 到顶不逐出（user 专属，Desktop 同款）', () => {
        const { governor, evicted } = makeEvictGovernor({ candidates: [{ sessionId: 'old-1' }] })
        expect(governor.acquireSlot('warm').granted).toBe(false)
        expect(governor.acquireSlot('prewarm').granted).toBe(false)
        expect(evicted).toEqual([])
    })

    it('逐出失败：名额收回遥测，不破上限', async () => {
        const { governor, events } = makeEvictGovernor({
            candidates: [{ sessionId: 'old-1' }],
            evictResult: false,
        })
        expect(governor.acquireSlot('user').granted).toBe(true) // 已授予（best-effort）
        await Promise.resolve()
        await Promise.resolve()
        // 逐出失败后 activeCount 未降，evicting 已移除：effective 回到 7（短暂超发，
        // 与 Desktop 同为 best-effort；遥测面记录失败供审计）
        expect(events.some((e) => e.type === 'governor_evict_failed')).toBe(true)
    })
})

describe('内存分级（票 2.2）', () => {
    function makeMemoryGovernor(levels: Array<'normal' | 'warning' | 'critical'>) {
        let i = 0
        const events: Array<Record<string, unknown>> = []
        const governor = new SessionGovernor({
            getActiveCount: () => 0,
            totalmem: 16 * GIB, // cap 6
            onEvent: (event) => { events.push(event as unknown as Record<string, unknown>) },
            getMemoryPressure: () => levels[Math.min(i, levels.length - 1)]!,
            now: () => NOW,
        })
        governor.evaluateMemoryPressure() // 消费 levels[0]（初始档）
        const tick = () => { i += 1; governor.evaluateMemoryPressure() }
        return { governor, events, tick }
    }

    it('critical → cap 折半（钳下限 6）', () => {
        const { governor, tick } = makeMemoryGovernor(['normal', 'critical'])
        expect(governor.cap).toBe(6) // 16GB 机公式本就 6，折半被下限钳住
        tick()
        expect(governor.cap).toBe(6)
        // 换大内存机证折半：override 提到 20 → critical 10
        let level: 'normal' | 'critical' = 'normal'
        const big = new SessionGovernor({
            getActiveCount: () => 0,
            totalmem: 64 * GIB, // 公式 21
            getCapOverride: () => 20,
            getMemoryPressure: () => level,
            now: () => NOW,
        })
        big.evaluateMemoryPressure()
        expect(big.cap).toBe(20)
        level = 'critical'
        big.evaluateMemoryPressure()
        expect(big.cap).toBe(10)
    })

    it('warning → normal 滞回：单次 normal 不回落，连续两次才回落', () => {
        const { governor, tick } = makeMemoryGovernor(['normal', 'warning', 'normal', 'normal'])
        tick() // warning
        expect(governor.memoryLevel).toBe('warning')
        tick() // 第一次 normal：保持 warning（滞回）
        expect(governor.memoryLevel).toBe('warning')
        tick() // 第二次 normal：回落
        expect(governor.memoryLevel).toBe('normal')
    })

    it('critical → warning 单步即回落 critical（下行不滞回，只 warning→normal 滞回）', () => {
        const { governor, tick } = makeMemoryGovernor(['normal', 'critical', 'warning'])
        tick()
        expect(governor.memoryLevel).toBe('critical')
        tick()
        expect(governor.memoryLevel).toBe('warning')
    })

    it('分级变化记遥测', () => {
        const { governor, events, tick } = makeMemoryGovernor(['normal', 'warning'])
        tick()
        expect(events).toContainEqual(expect.objectContaining({ type: 'governor_memory_pressure', level: 'warning' }))
    })
})

// ============ local 排除（总纲裁决 #12）+ 内存阈值纯函数 ============

import { evaluateMemoryPressure } from '@/executor/sessionGovernor'

describe('local 模式排除（裁决 #12：仅占名额，不逐出）', () => {
    const local = (sessionId: string, lastActivityAt: number) => ({
        sessionId, state: 'idle' as const, lastActivityAt, gateBlockers: [], mode: 'local' as const,
    })

    it('local 会话再空闲也不可被逐（候选过滤）', () => {
        const remote = { sessionId: 'r', state: 'idle' as const, lastActivityAt: IDLE_SINCE, gateBlockers: [], mode: 'remote' as const }
        // local 更久未活动，但不可逐 → 选中 remote
        expect(pickLruIdleVictim([local('l', NOW - 999_999), remote], NOW)).toBe('r')
        // 只有 local 候选 → 无受害者
        expect(pickLruIdleVictim([local('l', IDLE_SINCE)], NOW)).toBeNull()
    })
})

describe('evaluateMemoryPressure（阈值纯函数）', () => {
    const TB = 64 * 1024 ** 3

    it('可用内存分级：< 7% critical、< 15% warning、否则 normal', () => {
        expect(evaluateMemoryPressure(TB * 0.06, TB, 0)).toBe('critical')
        expect(evaluateMemoryPressure(TB * 0.10, TB, 0)).toBe('warning')
        expect(evaluateMemoryPressure(TB * 0.50, TB, 0)).toBe('normal')
    })

    it('rss 汇总分级：> 85% total critical、> 70% warning', () => {
        expect(evaluateMemoryPressure(TB, TB, TB * 0.9)).toBe('critical')
        expect(evaluateMemoryPressure(TB, TB, TB * 0.8)).toBe('warning')
        expect(evaluateMemoryPressure(TB, TB, TB * 0.5)).toBe('normal')
    })
})

// ============ macOS 可用内存口径修正（票 4.2 收尾发现的 bug） ============

import { parseVmStatFreeBytes } from '@/executor/sessionGovernor'

describe('parseVmStatFreeBytes（macOS 可用内存口径）', () => {
    it('free + speculative + purgeable + inactive 求和（对齐 memory_pressure 口径）', () => {
        const output = [
            'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
            'Pages free:                             11000.',
            'Pages active:                          300000.',
            'Pages inactive:                        514212.',
            'Pages speculative:                      22000.',
            'Pages wired down:                       300000.',
            'Pages purgeable:                         5000.',
            'Pages stored in compressor:            2765417.',
        ].join('\n')
        // (11000 + 514212 + 22000 + 5000) * 16384
        expect(parseVmStatFreeBytes(output, 16384)).toBe(552_212 * 16384)
    })

    it('字段缺失按 0 容错（不误判为零可用）', () => {
        expect(parseVmStatFreeBytes('garbage output', 16384)).toBe(0)
    })
})
