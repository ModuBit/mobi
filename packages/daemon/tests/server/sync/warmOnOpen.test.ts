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
 * WarmOnOpenCoordinator（迭代三票 3.3，warm-on-open）的测试面：
 * 点开 pause（休眠）态会话停留 ≥2s → 防抖触发冷 resume；快速滑走不触发；
 * 同会话去重；Governor yield 即放弃。全部假件驱动（会话状态 / warm 动作 / 预算闸）。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'

import { WarmOnOpenCoordinator, WARM_ON_OPEN_DEBOUNCE_MS } from '../../../src/sync/warmOnOpen'
import type { SyncEventListener } from '../../../src/sync/eventPublisher'
import type { Session, SyncEvent } from '@mobi/shared/types'

type SessionState = { active: boolean; endReason: Session['endReason'] }

/** 假调度器：手动推进虚拟时间（bun:test 无 timer mock，调度器注入即测试面） */
class FakeScheduler {
    private seq = 0
    private tasks: Array<{ at: number; fn: () => void; id: number }> = []
    now = 1_000_000

    schedule = (fn: () => void, ms: number): (() => void) => {
        const id = ++this.seq
        this.tasks.push({ at: this.now + ms, fn, id })
        return () => { this.tasks = this.tasks.filter((t) => t.id !== id) }
    }

    advance(ms: number): void {
        const target = this.now + ms
        // 依时间序逐个触发（触发中可能又排新任务）
        for (;;) {
            const next = this.tasks.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0]
            if (!next) break
            this.tasks = this.tasks.filter((t) => t.id !== next.id)
            this.now = next.at
            next.fn()
        }
        this.now = target
    }
}

function makeCoordinator(overrides: {
    sessions?: Record<string, SessionState>
    warmResult?: 'ok' | 'fail' | 'yield'
} = {}) {
    const sessions: Record<string, SessionState> = overrides.sessions ?? {}
    const events: Array<Record<string, unknown>> = []
    const warmCalls: string[] = []
    const warmDeferred: Array<() => void> = []
    const scheduler = new FakeScheduler()

    const coordinator = new WarmOnOpenCoordinator({
        getSession: (sessionId) => sessions[sessionId],
        // warm 动作可控 resolve（warming 中状态的去重断言需要挂起窗口）；
        // 三态由实现方提供：'warmed' / 'yielded'，失败走 reject
        warmSession: (sessionId) => new Promise<'warmed' | 'yielded'>((resolve, reject) => {
            warmCalls.push(sessionId)
            if (overrides.warmResult === 'fail') { reject(new Error('spawn failed')); return }
            if (overrides.warmResult === 'yield') { resolve('yielded'); return }
            warmDeferred.push(() => resolve('warmed'))
        }),
        onEvent: (event) => { events.push(event as unknown as Record<string, unknown>) },
        schedule: scheduler.schedule,
        now: () => scheduler.now,
    })

    return {
        coordinator, events, warmCalls, scheduler,
        /** 手动放行一次挂起中的 warm */
        settleWarm: () => { warmDeferred.shift()?.() },
        seedSession: (id: string, state: SessionState) => { sessions[id] = state },
    }
}

const PAUSED: SessionState = { active: false, endReason: 'pause' }

describe('WarmOnOpenCoordinator', () => {
    test('打开 pause 态会话停留 ≥2s → 触发 warm（reviveSession）+ warmLeadMs 遥测', async () => {
        const h = makeCoordinator({ sessions: { s1: PAUSED } })
        h.coordinator.onSessionViewed('s1', true)

        expect(h.warmCalls).toEqual([])          // 防抖窗口内未触发
        h.scheduler.advance(WARM_ON_OPEN_DEBOUNCE_MS)
        expect(h.warmCalls).toEqual(['s1'])      // 到点触发

        h.settleWarm()                            // warm 完成
        await Promise.resolve(); await Promise.resolve() // fire 是 async，事件落点在微任务后
        expect(h.events).toContainEqual(expect.objectContaining({ type: 'warm_done' }))
        const done = h.events.find((e) => e.type === 'warm_done') as { warmLeadMs: number }
        expect(done.warmLeadMs).toBeGreaterThanOrEqual(0) // 语义=触发→就绪（不含防抖窗）
    })

    test('翻列表快速滑走（<2s hidden）→ 不触发', () => {
        const h = makeCoordinator({ sessions: { s1: PAUSED } })
        h.coordinator.onSessionViewed('s1', true)
        h.scheduler.advance(WARM_ON_OPEN_DEBOUNCE_MS - 1)
        h.coordinator.onSessionViewed('s1', false) // 滑走
        h.scheduler.advance(WARM_ON_OPEN_DEBOUNCE_MS * 2)
        expect(h.warmCalls).toEqual([])
    })

    test('非 pause 态（active / stop 终态）不触发', () => {
        const h = makeCoordinator({ sessions: {
            a: { active: true, endReason: null },
            b: { active: false, endReason: 'stop' },
        } })
        h.coordinator.onSessionViewed('a', true)
        h.coordinator.onSessionViewed('b', true)
        h.scheduler.advance(WARM_ON_OPEN_DEBOUNCE_MS * 2)
        expect(h.warmCalls).toEqual([])
    })

    test('去重：防抖中重复 visible 只计一次；warming 中再来不重复触发', () => {
        const h = makeCoordinator({ sessions: { s1: PAUSED } })
        h.coordinator.onSessionViewed('s1', true)
        h.coordinator.onSessionViewed('s1', true)  // 防抖中去重
        h.scheduler.advance(WARM_ON_OPEN_DEBOUNCE_MS)
        expect(h.warmCalls).toEqual(['s1'])

        h.coordinator.onSessionViewed('s1', true)  // warming 中去重
        h.settleWarm()
        h.scheduler.advance(WARM_ON_OPEN_DEBOUNCE_MS)
        expect(h.warmCalls).toEqual(['s1'])
    })

    test('warm 完成后（active）再打开不重复触发', () => {
        const h = makeCoordinator({ sessions: { s1: PAUSED } })
        h.coordinator.onSessionViewed('s1', true)
        h.scheduler.advance(WARM_ON_OPEN_DEBOUNCE_MS)
        h.settleWarm()
        h.seedSession('s1', { active: true, endReason: null }) // resume 落地

        h.coordinator.onSessionViewed('s1', true)
        h.scheduler.advance(WARM_ON_OPEN_DEBOUNCE_MS * 2)
        expect(h.warmCalls).toEqual(['s1'])
    })

    test('预算闸 yield → 放弃不排队，遥测 warm_yielded', async () => {
        const h = makeCoordinator({ sessions: { s1: PAUSED }, warmResult: 'yield' })
        h.coordinator.onSessionViewed('s1', true)
        h.scheduler.advance(WARM_ON_OPEN_DEBOUNCE_MS)
        await Promise.resolve(); await Promise.resolve()
        expect(h.warmCalls).toEqual(['s1'])
        expect(h.events).toContainEqual(expect.objectContaining({ type: 'warm_yielded' }))
        expect(h.events.some((e) => e.type === 'warm_failed')).toBe(false)
    })

    test('warm 失败 → 清状态，下次打开可再触发', async () => {
        const h = makeCoordinator({ sessions: { s1: PAUSED }, warmResult: 'fail' })
        h.coordinator.onSessionViewed('s1', true)
        h.scheduler.advance(WARM_ON_OPEN_DEBOUNCE_MS)
        expect(h.warmCalls).toEqual(['s1'])
        await Promise.resolve(); await Promise.resolve() // catch 落点在微任务后
        expect(h.events).toContainEqual(expect.objectContaining({ type: 'warm_failed' }))

        h.coordinator.onSessionViewed('s1', true)
        h.scheduler.advance(WARM_ON_OPEN_DEBOUNCE_MS)
        expect(h.warmCalls).toEqual(['s1', 's1'])
    })

    test('visible→hidden→visible 重开窗口重新计防抖', () => {
        const h = makeCoordinator({ sessions: { s1: PAUSED } })
        h.coordinator.onSessionViewed('s1', true)
        h.scheduler.advance(WARM_ON_OPEN_DEBOUNCE_MS - 1)
        h.coordinator.onSessionViewed('s1', false)
        h.coordinator.onSessionViewed('s1', true)  // 重新打开：窗口从头计
        h.scheduler.advance(WARM_ON_OPEN_DEBOUNCE_MS - 1)
        expect(h.warmCalls).toEqual([])            // 原窗口若未重置此刻已触发
        h.scheduler.advance(1)
        expect(h.warmCalls).toEqual(['s1'])
    })
})

// ============ warmAbandoned 判定面（票 4.2） ============

describe('WarmOnOpenCoordinator warmAbandoned', () => {
    test('warm 兑现后无活动且再次休眠 → warm_abandoned', async () => {
        const h = makeCoordinator({ sessions: { s1: PAUSED } })
        h.coordinator.onSessionViewed('s1', true)
        h.scheduler.advance(WARM_ON_OPEN_DEBOUNCE_MS)
        h.settleWarm()
        await Promise.resolve(); await Promise.resolve()

        h.coordinator.observeSessionPaused('s1')
        expect(h.events).toContainEqual(expect.objectContaining({ type: 'warm_abandoned', sessionId: 's1' }))
    })

    test('warm 兑现后用户活动 → 再次休眠不算 abandoned', async () => {
        const h = makeCoordinator({ sessions: { s1: PAUSED } })
        h.coordinator.onSessionViewed('s1', true)
        h.scheduler.advance(WARM_ON_OPEN_DEBOUNCE_MS)
        h.settleWarm()
        await Promise.resolve(); await Promise.resolve()

        h.coordinator.observeUserActivity('s1')
        h.coordinator.observeSessionPaused('s1')
        expect(h.events.some((e) => e.type === 'warm_abandoned')).toBe(false)
    })

    test('attachEventSource：事件流翻译——session-updated 非 active 记 abandoned', async () => {
        // 候选④：观察接线由 server 内联订阅收编进 coordinator，装配层只给订阅函数
        const h = makeCoordinator({ sessions: { s1: PAUSED } })
        let handler: SyncEventListener = () => {}
        h.coordinator.attachEventSource((cb) => { handler = cb; return () => {} })

        h.coordinator.onSessionViewed('s1', true)
        h.scheduler.advance(WARM_ON_OPEN_DEBOUNCE_MS)
        h.settleWarm()
        await Promise.resolve(); await Promise.resolve()

        handler({ type: 'session-updated', sessionId: 's1' })
        expect(h.events).toContainEqual(expect.objectContaining({ type: 'warm_abandoned', sessionId: 's1' }))
    })

    test('attachEventSource：message-received 解除观察（用户用上了热身成果）', async () => {
        const h = makeCoordinator({ sessions: { s1: PAUSED } })
        let handler: SyncEventListener = () => {}
        h.coordinator.attachEventSource((cb) => { handler = cb; return () => {} })

        h.coordinator.onSessionViewed('s1', true)
        h.scheduler.advance(WARM_ON_OPEN_DEBOUNCE_MS)
        h.settleWarm()
        await Promise.resolve(); await Promise.resolve()

        handler({ type: 'message-received', sessionId: 's1' } as SyncEvent)
        handler({ type: 'session-updated', sessionId: 's1' })
        expect(h.events.some((e) => e.type === 'warm_abandoned')).toBe(false)
    })
})
