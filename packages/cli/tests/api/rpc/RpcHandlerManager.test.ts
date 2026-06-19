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

import { describe, it, expect, vi } from 'vitest'
import { RpcHandlerManager } from '../../../src/api/rpc/RpcHandlerManager'

// Characterization 测试：锁定 RpcHandlerManager 现有行为，
// 为 lint any→unknown 收窄提供回归保护。
describe('RpcHandlerManager', () => {
    it('注册并处理请求（带 scopePrefix 前缀）', async () => {
        const m = new RpcHandlerManager({ scopePrefix: 's' })
        m.registerHandler<{ x: number }, { doubled: number }>(
            'echo',
            async (p) => ({ doubled: p.x * 2 })
        )
        // method 在 handleRequest 中需带 scopePrefix
        const res = await m.handleRequest({
            method: 's:echo',
            params: JSON.stringify({ x: 3 })
        })
        expect(JSON.parse(res)).toEqual({ doubled: 6 })
    })

    it('method not found 返回 error', async () => {
        const m = new RpcHandlerManager({ scopePrefix: 's' })
        const res = await m.handleRequest({ method: 's:nope', params: '{}' })
        expect(JSON.parse(res)).toEqual({ error: 'Method not found' })
    })

    it('handler 抛错时返回 error', async () => {
        const m = new RpcHandlerManager({ scopePrefix: 's' })
        m.registerHandler('boom', async () => {
            throw new Error('boom')
        })
        const res = await m.handleRequest({ method: 's:boom', params: '{}' })
        expect(JSON.parse(res)).toEqual({ error: 'boom' })
    })

    it('非 Error 抛出时返回 Unknown error', async () => {
        const m = new RpcHandlerManager({ scopePrefix: 's' })
        m.registerHandler('str', async () => {
            throw 'oops'
        })
        const res = await m.handleRequest({ method: 's:str', params: '{}' })
        expect(JSON.parse(res)).toEqual({ error: 'Unknown error' })
    })

    it('skipIdleTimerReset: true 跳过 onRpcCalled 回调', async () => {
        const m = new RpcHandlerManager({ scopePrefix: 's' })
        const cb = vi.fn()
        m.setOnRpcCalled(cb)
        m.registerHandler('silent', async () => null, {
            skipIdleTimerReset: true
        })
        await m.handleRequest({ method: 's:silent', params: '{}' })
        expect(cb).not.toHaveBeenCalled()
    })

    it('默认（无 skipIdleTimerReset）触发 onRpcCalled 回调', async () => {
        const m = new RpcHandlerManager({ scopePrefix: 's' })
        const cb = vi.fn()
        m.setOnRpcCalled(cb)
        m.registerHandler('loud', async () => null)
        await m.handleRequest({ method: 's:loud', params: '{}' })
        expect(cb).toHaveBeenCalledTimes(1)
    })

    it('hasHandler 检查带前缀的处理器存在', () => {
        const m = new RpcHandlerManager({ scopePrefix: 's' })
        m.registerHandler('foo', async () => null)
        expect(m.hasHandler('foo')).toBe(true)
        expect(m.hasHandler('nope')).toBe(false)
        expect(m.getHandlerCount()).toBe(1)
    })

    it('clearHandlers 清空所有处理器', () => {
        const m = new RpcHandlerManager({ scopePrefix: 's' })
        m.registerHandler('foo', async () => null)
        m.clearHandlers()
        expect(m.getHandlerCount()).toBe(0)
    })

    it('自定义 logger 被调用', async () => {
        const logger = vi.fn()
        const m = new RpcHandlerManager({ scopePrefix: 's', logger })
        await m.handleRequest({ method: 's:nope', params: '{}' })
        expect(logger).toHaveBeenCalled()
        // 第一参数是消息
        expect(logger.mock.calls[0]?.[0]).toContain('Method not found')
    })

    it('JSON 解析失败时 params 为 null 传给 handler', async () => {
        const m = new RpcHandlerManager({ scopePrefix: 's' })
        const received: unknown[] = []
        m.registerHandler<unknown, { ok: true }>('parseFail', async (p) => {
            received.push(p)
            return { ok: true }
        })
        const res = await m.handleRequest({
            method: 's:parseFail',
            params: 'not-json'
        })
        expect(JSON.parse(res)).toEqual({ ok: true })
        expect(received[0]).toBeNull()
    })
})
