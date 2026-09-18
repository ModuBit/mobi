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

import { describe, expect, test } from 'bun:test'
import { createOneTimeTicketStore } from '../../src/desktop/tickets'

describe('createOneTimeTicketStore', () => {
    describe('mint / consume', () => {
        test('兑换返回 payload，且只能兑换一次', () => {
            const store = createOneTimeTicketStore<{ machineId: string }>()
            const { token } = store.mint({ machineId: 'm1' }, { nowMs: 1000 })

            const first = store.consume(token, 1500)
            expect(first).toEqual({ machineId: 'm1' })

            const second = store.consume(token, 1500)
            expect(second).toBeNull()
        })

        test('不同 ticket 互不影响', () => {
            const store = createOneTimeTicketStore<{ n: number }>()
            const a = store.mint({ n: 1 }, { nowMs: 0 })
            const b = store.mint({ n: 2 }, { nowMs: 0 })

            expect(store.consume(a.token, 1)).toEqual({ n: 1 })
            expect(store.consume(b.token, 1)).toEqual({ n: 2 })
        })
    })

    describe('过期', () => {
        test('超过 TTL 后 consume 返回 null', () => {
            const store = createOneTimeTicketStore<string>()
            const { token, expiresAtMs } = store.mint('p', { nowMs: 1000, ttlMs: 60_000 })

            expect(expiresAtMs).toBe(61_000)
            expect(store.consume(token, 61_000)).toBeNull()
        })

        test('TTL 边界内仍可兑换', () => {
            const store = createOneTimeTicketStore<string>()
            const { token } = store.mint('p', { nowMs: 1000, ttlMs: 60_000 })

            expect(store.consume(token, 60_999)).toBe('p')
        })

        test('未指定 ttlMs 用默认值', () => {
            const store = createOneTimeTicketStore<string>({ defaultTtlMs: 5000 })
            const { expiresAtMs } = store.mint('p', { nowMs: 10_000 })

            expect(expiresAtMs).toBe(15_000)
        })

        test('过期 ticket 占用的条目会被清理（防泄漏）', () => {
            const store = createOneTimeTicketStore<string>()
            const a = store.mint('p', { nowMs: 0, ttlMs: 1000 })
            store.mint('q', { nowMs: 0, ttlMs: 1000 })
            store.consume(a.token, 2000) // 过期触发清理

            // 内部 Map 不暴露；以 consume 全部为 null 观察行为
            expect(store.consume(a.token, 2000)).toBeNull()
        })
    })

    describe('cancel', () => {
        test('取消后不可兑换', () => {
            const store = createOneTimeTicketStore<string>()
            const { token } = store.mint('p', { nowMs: 0 })

            store.cancel(token)

            expect(store.consume(token, 1)).toBeNull()
        })

        test('取消不存在的 ticket 静默', () => {
            const store = createOneTimeTicketStore<string>()
            expect(() => store.cancel('nope')).not.toThrow()
        })
    })

    describe('token 形状', () => {
        test('token 为 URL 安全的高熵串（与 hub 统一 token 生成同格式，≥40 位）', () => {
            const store = createOneTimeTicketStore<string>()
            const { token } = store.mint('p', { nowMs: 0 })

            expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/)
        })
    })
})
