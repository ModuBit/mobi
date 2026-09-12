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
import { SessionReceiveReadiness } from '../../src/sync/sessionReceiveReadiness'

/** 等待者名单是私有状态——这里只为验「超时不泄漏」而探一眼（该性质没有外部表现） */
function pendingWaiters(readiness: SessionReceiveReadiness, sessionId: string): number {
    const inner = readiness as unknown as { waiters: Map<string, Set<unknown>> }
    return inner.waiters.get(sessionId)?.size ?? 0
}


describe('SessionReceiveReadiness — 等事实，不是等事件', () => {
    test('事实早于等待 → 立即返回，不挂等待者、不等满超时', async () => {
        const readiness = new SessionReceiveReadiness()
        readiness.set('s1', true)

        const started = Date.now()
        const result = await readiness.waitUntilCanReceive('s1', 1000)

        // 这就是「等事件」写法会丢的那个场景：翻转已经发生过，后到的等待仍拿得到
        expect(result).toBe('ready')
        expect(Date.now() - started).toBeLessThan(100)
        expect(pendingWaiters(readiness, 's1')).toBe(0)
    })

    test('事实晚于等待 → 被叫醒，不等到超时', async () => {
        const readiness = new SessionReceiveReadiness()

        setTimeout(() => readiness.set('s2', true), 20)
        const started = Date.now()
        const result = await readiness.waitUntilCanReceive('s2', 1000)

        expect(result).toBe('ready')
        expect(Date.now() - started).toBeGreaterThanOrEqual(15)
        expect(Date.now() - started).toBeLessThan(500)
    })

    test('等满超时 → 回 timeout，且等待者被摘掉（不留下叫不醒的回调）', async () => {
        const readiness = new SessionReceiveReadiness()

        const result = await readiness.waitUntilCanReceive('s3', 30)

        expect(result).toBe('timeout')
        expect(pendingWaiters(readiness, 's3')).toBe(0)
    })

    test('等待期间翻成「不能收」→ 立刻返回确定结论，不陪等满超时', async () => {
        const readiness = new SessionReceiveReadiness()

        setTimeout(() => readiness.set('s4', false), 20)
        const started = Date.now()
        const result = await readiness.waitUntilCanReceive('s4', 1000)

        // 「不能收」是确定的否定答案，与「还没好」是两回事——所以不该陪着等
        expect(result).toBe('unavailable')
        expect(Date.now() - started).toBeLessThan(500)
    })

    test('已经确定不能收时来等 → 立即返回 unavailable，一个等待者都不挂', async () => {
        const readiness = new SessionReceiveReadiness()
        readiness.set('s5', false)

        const started = Date.now()
        const result = await readiness.waitUntilCanReceive('s5', 1000)

        expect(result).toBe('unavailable')
        expect(Date.now() - started).toBeLessThan(100)
        expect(pendingWaiters(readiness, 's5')).toBe(0)
    })

    test('两个等待者同时等同一个会话 → 一次翻转全叫醒', async () => {
        const readiness = new SessionReceiveReadiness()

        setTimeout(() => readiness.set('s6', true), 20)
        const results = await Promise.all([
            readiness.waitUntilCanReceive('s6', 1000),
            readiness.waitUntilCanReceive('s6', 1000),
        ])

        expect(results).toEqual(['ready', 'ready'])
        expect(pendingWaiters(readiness, 's6')).toBe(0)
    })

    test('互不干扰：等 A 的不会被 B 的翻转叫醒', async () => {
        const readiness = new SessionReceiveReadiness()

        const waitingA = readiness.waitUntilCanReceive('a', 120)
        setTimeout(() => readiness.set('b', true), 10)

        expect(await waitingA).toBe('timeout')
    })

    test('没上报过就是没定论，不是「不能收」', async () => {
        const readiness = new SessionReceiveReadiness()

        expect(readiness.get('never-reported')).toBeUndefined()
        expect(await readiness.waitUntilCanReceive('never-reported', 20)).toBe('timeout')
    })

    test('翻转会覆盖旧值（每轮收尾清空、下一轮再接上）', async () => {
        const readiness = new SessionReceiveReadiness()

        readiness.set('s7', true)
        expect(readiness.get('s7')).toBe(true)
        readiness.set('s7', false)
        expect(readiness.get('s7')).toBe(false)
        readiness.set('s7', true)
        expect(readiness.get('s7')).toBe(true)
    })

    test('醒来时读的是**当前**事实，不是「叫醒它的那个值」', async () => {
        const readiness = new SessionReceiveReadiness()

        // 先真后假挤在同一个同步块里：叫醒它的是 true，但它醒来时事实已经翻回 false。
        // 所以第 ③ 步的重读不是多余的——只看叫醒原因会给出一个已经过期的答案
        setTimeout(() => {
            readiness.set('s8', true)
            readiness.set('s8', false)
        }, 10)

        expect(await readiness.waitUntilCanReceive('s8', 1000)).toBe('unavailable')
    })
})

describe('SessionReceiveReadiness — 进程结束时抹掉事实（回到没定论）', () => {
    test('clear 后 get 回 undefined，等待也是 timeout 而非「不能收」', async () => {
        const readiness = new SessionReceiveReadiness()

        readiness.set('s1', false)
        readiness.clear('s1')

        // 关键差别：留 false 会让下一次询问拿到确定的否定结论（unavailable），
        // 而进程刚结束的真相应是「没有定论」
        expect(readiness.get('s1')).toBeUndefined()
        expect(await readiness.waitUntilCanReceive('s1', 20)).toBe('timeout')
    })

    test('clear 后再上报仍然生效（重启的进程接上后又报 true）', async () => {
        const readiness = new SessionReceiveReadiness()

        readiness.set('s2', true)
        readiness.clear('s2')
        readiness.set('s2', true)

        expect(await readiness.waitUntilCanReceive('s2', 20)).toBe('ready')
    })

    test('clear 不叫醒等待者——它等的是「能不能收」，进程结束不构成答案', async () => {
        const readiness = new SessionReceiveReadiness()

        const waiting = readiness.waitUntilCanReceive('s3', 30)
        expect(pendingWaiters(readiness, 's3')).toBe(1)

        readiness.clear('s3')

        expect(await waiting).toBe('timeout')
        expect(pendingWaiters(readiness, 's3')).toBe(0)
    })

    test('clear 只影响那一个会话', () => {
        const readiness = new SessionReceiveReadiness()

        readiness.set('s4', true)
        readiness.set('s5', true)
        readiness.clear('s4')

        expect(readiness.get('s4')).toBeUndefined()
        expect(readiness.get('s5')).toBe(true)
    })
})
