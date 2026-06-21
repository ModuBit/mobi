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

import { describe, it, expect } from 'vitest'
import { createRpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import type { RpcRequest } from '@/api/rpc/types'

// 模拟 hub→cli 的 rpc-request 往返：调 handleRequest 拿到 handler 结果对象
describe('RPC 序列化：对象直传（不再 JSON.stringify）', () => {
    it('handler 返回的纯对象被原样返回（不 stringify）', async () => {
        const mgr = createRpcHandlerManager({ scopePrefix: 's1' })
        mgr.registerHandler('echo', async (p) => ({ success: true, echo: p }))

        const req: RpcRequest = { method: 's1:echo', params: { a: 1 } }
        const result = await mgr.handleRequest(req) as { success: boolean; echo: unknown }

        expect(result).toEqual({ success: true, echo: { a: 1 } })
        expect(typeof result).toBe('object')
    })

    it('handler 返回含 Uint8Array 的对象（二进制附件），结构保留', async () => {
        const mgr = createRpcHandlerManager({ scopePrefix: 's1' })
        mgr.registerHandler('binary', async () => {
            const buf = Uint8Array.from([1, 2, 3, 4, 5])
            return { success: true, chunk: buf }
        })

        const result = await mgr.handleRequest({ method: 's1:binary', params: {} }) as {
            success: boolean; chunk: Uint8Array
        }

        expect(result.success).toBe(true)
        expect(result.chunk instanceof Uint8Array).toBe(true)
        expect(Array.from(result.chunk)).toEqual([1, 2, 3, 4, 5])
    })

    it('params 直接是对象，handler 收到原始对象', async () => {
        const mgr = createRpcHandlerManager({ scopePrefix: 's1' })
        let received: unknown = null
        mgr.registerHandler('inspect', async (p) => { received = p; return { ok: true } })

        await mgr.handleRequest({ method: 's1:inspect', params: { nested: { x: 'y' } } })
        expect(received).toEqual({ nested: { x: 'y' } })
    })
})
