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
 * QuitCleanup（迭代四票 4.1，onQuitCleanup）的测试面：注册表（重复 name 报错）、
 * 逐 handler 计时、并发上限 4、总时限到点放弃未完成者不阻塞退出、放弃名单。
 */

import { describe, it, expect, vi } from 'vitest'
import { QuitCleanup, QUIT_HANDLER_CONCURRENCY } from '@/quitCleanup'

const sleep = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms) })

describe('QuitCleanup', () => {
    it('正常完成：全部执行、逐项计时、无放弃', async () => {
        const quit = new QuitCleanup()
        quit.registerQuitHandler('a', () => sleep(10))
        quit.registerQuitHandler('b', () => sleep(30))

        const result = await quit.runAll(1_000)

        expect(result.completed.sort()).toEqual(['a', 'b'])
        expect(result.abandoned).toEqual([])
        expect(result.timings.a).toBeGreaterThanOrEqual(10)
        expect(result.timings.b).toBeGreaterThanOrEqual(30)
    })

    it('慢 handler 超总时限被放弃，不拖总时长', async () => {
        vi.useFakeTimers()
        try {
            const quit = new QuitCleanup()
            quit.registerQuitHandler('fast', () => sleep(10))
            quit.registerQuitHandler('slow', () => sleep(60_000))

            const startedAt = Date.now()
            const pending = quit.runAll(100)
            // 推进虚拟时钟到总时限（含 margin），runAll 必须已落定
            await vi.advanceTimersByTimeAsync(150)
            const result = await pending

            expect(Date.now() - startedAt).toBeLessThan(1_000) // 没等慢 handler 的 60s
            expect(result.completed).toEqual(['fast'])
            expect(result.abandoned).toEqual(['slow'])
        } finally {
            vi.useRealTimers()
        }
    })

    it('并发上限 4：8 个 handler 任意时刻并发 ≤4', async () => {
        let inflight = 0
        let peak = 0
        const quit = new QuitCleanup()
        for (let i = 0; i < 8; i++) {
            quit.registerQuitHandler(`h${i}`, async () => {
                inflight++
                peak = Math.max(peak, inflight)
                await sleep(5)
                inflight--
            })
        }

        await quit.runAll(1_000)
        expect(peak).toBeLessThanOrEqual(QUIT_HANDLER_CONCURRENCY)
        expect(QUIT_HANDLER_CONCURRENCY).toBe(4)
        expect(peak).toBeGreaterThan(1) // 确实并发了（探针非退化）
    })

    it('重复 name 注册报错', () => {
        const quit = new QuitCleanup()
        quit.registerQuitHandler('x', () => Promise.resolve())
        expect(() => quit.registerQuitHandler('x', () => Promise.resolve())).toThrow(/duplicate/i)
    })

    it('单个 handler 抛错不影响其余（错误吞掉记日志，不算放弃）', async () => {
        const quit = new QuitCleanup()
        quit.registerQuitHandler('bad', async () => { throw new Error('boom') })
        quit.registerQuitHandler('good', () => sleep(5))

        const result = await quit.runAll(1_000)
        expect(result.completed).toEqual(['good'])
        expect(result.abandoned).toEqual([])
        expect(result.failed).toEqual(['bad'])
    })

    it('未注册任何 handler 直接返回', async () => {
        const quit = new QuitCleanup()
        const result = await quit.runAll(100)
        expect(result).toEqual({ completed: [], abandoned: [], failed: [], timings: {} })
    })
})
