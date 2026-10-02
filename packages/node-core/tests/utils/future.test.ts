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

// Characterization tests for utils/future.ts —— 锁定现有行为
// 收窄 any→unknown 前后这些断言必须保持绿
import { describe, it, expect } from 'vitest'
import { Future } from '@/utils/future'

describe('Future', () => {
    it('resolve 后 await 得值', async () => {
        const fut = new Future<number>()
        fut.resolve(42)
        await expect(fut.promise).resolves.toBe(42)
    })

    it('reject 后 await 抛错', async () => {
        const fut = new Future<string>()
        const err = new Error('boom')
        fut.reject(err)
        await expect(fut.promise).rejects.toBe(err)
    })

    it('reject 可不带理由（reason=undefined）', async () => {
        const fut = new Future<number>()
        fut.reject()
        // reason 为 undefined，但仍触发 rejection
        await expect(fut.promise).rejects.toBeUndefined()
    })

    it('未 resolve/reject 时 promise pending', async () => {
        const fut = new Future<number>()
        // 用 race 验证 pending：1ms 内不 resolve
        const result = await Promise.race([
            fut.promise.then(() => 'resolved'),
            new Promise<'pending'>(r => setTimeout(() => r('pending'), 10))
        ])
        expect(result).toBe('pending')
    })

    it('先 await 再 resolve 也能拿到值', async () => {
        const fut = new Future<string>()
        const consumer = fut.promise.then(v => v)
        await Promise.resolve()
        fut.resolve('hello')
        expect(await consumer).toBe('hello')
    })

    it('泛型可承载对象', async () => {
        const fut = new Future<{ a: number }>()
        fut.resolve({ a: 1 })
        const v = await fut.promise
        expect(v).toEqual({ a: 1 })
    })
})
