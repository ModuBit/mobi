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
import { SocketRpcCaller } from '../../../src/sync/rpcCaller'
import { RpcFailure } from '../../../src/sync/rpcFailure'
import { makeFakeIo, makeFakeRegistry, makeFakeSocket } from './fakeTransport'

// ============ SocketRpcCaller.call 单测（护栏：验证二进制对象原样往返与三类故障分类） ============

describe('SocketRpcCaller.call', () => {
    test('params 对象直传，emitWithAck 收到的 params 是对象（非 JSON.stringify 的 string）', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({ response: { ok: true }, payloadCaptor })
        const io = makeFakeIo('sock-1', socket)
        const registry = makeFakeRegistry(new Map([['session-A:readFileMeta', 'sock-1']]))

        const caller = new SocketRpcCaller(io, registry)
        await caller.call('session-A:readFileMeta', { path: '/a/b.txt' })

        // 信封本身是对象
        expect(typeof payloadCaptor.value).toBe('object')
        const envelope = payloadCaptor.value as { method: string; params: unknown }
        expect(envelope.method).toBe('session-A:readFileMeta')
        // params 必须是对象，而不是被 JSON.stringify 成 string
        expect(typeof envelope.params).toBe('object')
        expect(envelope.params).toEqual({ path: '/a/b.txt' })
    })

    test('响应含 Uint8Array 时原样返回（结构保留，非 JSON.parse 重建）', async () => {
        const originalChunk = new Uint8Array([0x00, 0xff, 0x10, 0x20])
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({
            response: { success: true, chunk: originalChunk },
            payloadCaptor,
        })
        const io = makeFakeIo('sock-2', socket)
        const registry = makeFakeRegistry(new Map([['session-B:readFileRange', 'sock-2']]))

        const caller = new SocketRpcCaller(io, registry)
        const result = (await caller.call('session-B:readFileRange', {
            path: '/a/b.bin',
            offset: 0,
            length: 4,
        })) as { success: boolean; chunk: Uint8Array }

        expect(result.success).toBe(true)
        // 关键：返回的就是同一个 Uint8Array 实例（引用相等），证明未经过 JSON 序列化/反序列化
        expect(result.chunk).toBe(originalChunk)
        expect(result.chunk instanceof Uint8Array).toBe(true)
        expect(Array.from(result.chunk)).toEqual([0x00, 0xff, 0x10, 0x20])
    })

    test('method 未注册（registry 返回 null）→ throw 带 unreachable 分类的 RpcFailure', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({ response: {}, payloadCaptor })
        const io = makeFakeIo('sock-3', socket)
        const registry = makeFakeRegistry(new Map([['session-C:readFileMeta', null]]))

        const caller = new SocketRpcCaller(io, registry)
        const error = await caller.call('session-C:readFileMeta', { path: '/x' })
            .catch((thrown: unknown) => thrown)

        expect(error).toBeInstanceOf(RpcFailure)
        expect((error as RpcFailure).kind).toBe('unreachable')
        expect((error as RpcFailure).message).toMatch(/not registered/)
    })

    test('socket 不存在（registry 有 socketId 但 io 查不到）→ throw 带 unreachable 分类的 RpcFailure', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({ response: {}, payloadCaptor })
        // io 里注册的是 sock-real，但 registry 返回 sock-missing → 查不到
        const io = makeFakeIo('sock-real', socket)
        const registry = makeFakeRegistry(new Map([['session-D:readFileMeta', 'sock-missing']]))

        const caller = new SocketRpcCaller(io, registry)
        const error = await caller.call('session-D:readFileMeta', { path: '/y' })
            .catch((thrown: unknown) => thrown)

        expect(error).toBeInstanceOf(RpcFailure)
        expect((error as RpcFailure).kind).toBe('unreachable')
        expect((error as RpcFailure).message).toMatch(/disconnected/)
    })

    test('ack 超时（框架给的句子）→ throw 带 timeout 分类的 RpcFailure，文案原样', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({ rejects: new Error('operation has timed out'), payloadCaptor })
        const io = makeFakeIo('sock-5', socket)
        const registry = makeFakeRegistry(new Map([['session-E:readFileMeta', 'sock-5']]))

        const caller = new SocketRpcCaller(io, registry)
        const error = await caller.call('session-E:readFileMeta', { path: '/z' })
            .catch((thrown: unknown) => thrown)

        expect(error).toBeInstanceOf(RpcFailure)
        expect((error as RpcFailure).kind).toBe('timeout')
        expect((error as RpcFailure).message).toBe('operation has timed out')
    })

    test('别的传输异常 → throw 带 other 分类的 RpcFailure（句子原样带出去）', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({ rejects: new Error('parser error'), payloadCaptor })
        const io = makeFakeIo('sock-6', socket)
        const registry = makeFakeRegistry(new Map([['session-F:readFileMeta', 'sock-6']]))

        const caller = new SocketRpcCaller(io, registry)
        const error = await caller.call('session-F:readFileMeta', { path: '/w' })
            .catch((thrown: unknown) => thrown)

        expect(error).toBeInstanceOf(RpcFailure)
        expect((error as RpcFailure).kind).toBe('other')
        expect((error as RpcFailure).message).toBe('parser error')
    })
})
