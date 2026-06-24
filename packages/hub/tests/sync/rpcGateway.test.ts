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

import { describe, test, expect, mock } from 'bun:test'
import { RpcGateway } from '../../src/sync/rpcGateway'
import type { RpcRegistry } from '../../src/socket/rpcRegistry'

// ============ 辅助：构造 fake socket.io Server / Registry / Socket ============

/**
 * 捕获 emitWithAck 的 payload，并按预设返回 response。
 * payloadCaptor 用闭包持有最后一次传入的 params，供断言使用。
 */
interface FakeSocketOptions {
    /** emitWithAck 返回的响应 */
    response?: unknown
    /** 用于断言「捕获到什么」的写入槽 */
    payloadCaptor: { value: unknown }
}

/** 构造一个可被 rpcCall 使用的 fake socket */
function makeFakeSocket(opts: FakeSocketOptions) {
    return {
        timeout() {
            return this
        },
        async emitWithAck(_event: string, payload: unknown) {
            // 捕获整个 rpc-request 信封，便于断言 params 是否为对象
            opts.payloadCaptor.value = payload
            return opts.response
        },
    }
}

/** 构造 fake io：io.of('/cli').sockets.get(socketId) → fakeSocket */
function makeFakeIo(socketId: string, socket: ReturnType<typeof makeFakeSocket>) {
    const sockets = new Map<string, unknown>([[socketId, socket]])
    return {
        of() {
            return { sockets }
        },
    } as unknown as import('socket.io').Server
}

/** 构造 fake rpcRegistry */
function makeFakeRegistry(methodToSocketId: Map<string, string | null>): RpcRegistry {
    return {
        getSocketIdForMethod(method: string) {
            return methodToSocketId.get(method) ?? null
        },
    } as unknown as RpcRegistry
}

// ============ rpcCall 单测（护栏：验证二进制对象原样往返） ============

describe('RpcGateway.rpcCall', () => {
    test('params 对象直传，emitWithAck 收到的 params 是对象（非 JSON.stringify 的 string）', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({ response: { ok: true }, payloadCaptor })
        const io = makeFakeIo('sock-1', socket)
        // method 形如 `${sessionId}:${rpcMethod}`
        const registry = makeFakeRegistry(new Map([['session-A:readFileMeta', 'sock-1']]))

        const gateway = new RpcGateway(io, registry)
        // rpcCall 是 private，用 as any 直接访问以覆盖核心逻辑
        await (gateway as any).rpcCall('session-A:readFileMeta', { path: '/a/b.txt' })

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

        const gateway = new RpcGateway(io, registry)
        const result = (await (gateway as any).rpcCall('session-B:readFileRange', {
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

    test('method 未注册（registry 返回 null）→ throw', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({ response: {}, payloadCaptor })
        const io = makeFakeIo('sock-3', socket)
        const registry = makeFakeRegistry(new Map([['session-C:readFileMeta', null]]))

        const gateway = new RpcGateway(io, registry)
        await expect(
            (gateway as any).rpcCall('session-C:readFileMeta', { path: '/x' })
        ).rejects.toThrow(/not registered/)
    })

    test('socket 不存在（registry 有 socketId 但 io 查不到）→ throw', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({ response: {}, payloadCaptor })
        // io 里注册的是 sock-real，但 registry 返回 sock-missing → 查不到
        const io = makeFakeIo('sock-real', socket)
        const registry = makeFakeRegistry(new Map([['session-D:readFileMeta', 'sock-missing']]))

        const gateway = new RpcGateway(io, registry)
        await expect(
            (gateway as any).rpcCall('session-D:readFileMeta', { path: '/y' })
        ).rejects.toThrow(/disconnected/)
    })
})

// ============ uploadFileRange / machineUploadFileRange 二进制往返单测 ============

describe('RpcGateway.uploadFileRange', () => {
    test('content 以 Uint8Array 透传到 writeFileRange（非 base64 string）', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({
            response: { success: true, path: '.mobi/uploads/2026-01/test-abc.png', written: 3 },
            payloadCaptor,
        })
        const io = makeFakeIo('sock-up-s', socket)
        const registry = makeFakeRegistry(new Map([['session-up-test:writeFileRange', 'sock-up-s']]))

        const gateway = new RpcGateway(io, registry)
        const chunk = new Uint8Array([1, 2, 3])
        const result = await gateway.uploadFileRange('session-up-test', 'f.png', undefined, 0, chunk, 3)

        // 返回体
        expect(result.success).toBe(true)
        expect(result.path).toBe('.mobi/uploads/2026-01/test-abc.png')
        expect(result.written).toBe(3)

        // 捕获的 payload：content 必须是 Uint8Array（二进制附件），非 base64 string
        const envelope = payloadCaptor.value as { method: string; params: Record<string, unknown> }
        expect(envelope.method).toBe('session-up-test:writeFileRange')
        expect(envelope.params.filename).toBe('f.png')
        expect(envelope.params.offset).toBe(0)
        expect(envelope.params.totalSize).toBe(3)
        expect(envelope.params.content).toBeInstanceOf(Uint8Array)
        expect(envelope.params.content).toBe(chunk)  // 引用相等，证明未序列化
    })

    test('后续块（path + offset>0）透传正确', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({
            response: { success: true, written: 5 },
            payloadCaptor,
        })
        const io = makeFakeIo('sock-up-s2', socket)
        const registry = makeFakeRegistry(new Map([['session-up-test2:writeFileRange', 'sock-up-s2']]))

        const gateway = new RpcGateway(io, registry)
        const chunk = new Uint8Array([4, 5, 6, 7, 8])
        const result = await gateway.uploadFileRange('session-up-test2', 'f.png', '.mobi/uploads/2026-01/test-abc.png', 3, chunk)

        expect(result.success).toBe(true)
        expect(result.written).toBe(5)

        const envelope = payloadCaptor.value as { method: string; params: Record<string, unknown> }
        expect(envelope.params.path).toBe('.mobi/uploads/2026-01/test-abc.png')
        expect(envelope.params.offset).toBe(3)
        expect(envelope.params.content).toBe(chunk)
    })

    test('cli 拒绝（success:false）→ 错误透传', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({
            response: { success: false, error: 'File too large (max 50MB)' },
            payloadCaptor,
        })
        const io = makeFakeIo('sock-up-s3', socket)
        const registry = makeFakeRegistry(new Map([['session-up-test3:writeFileRange', 'sock-up-s3']]))

        const gateway = new RpcGateway(io, registry)
        const chunk = new Uint8Array([1])
        const result = await gateway.uploadFileRange('session-up-test3', 'big.bin', undefined, 0, chunk, 50 * 1024 * 1024 + 1)

        expect(result.success).toBe(false)
        expect(result.error).toBe('File too large (max 50MB)')
    })
})

describe('RpcGateway.machineUploadFileRange', () => {
    test('cwd 透传到 writeFileRange', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({
            response: { success: true, path: '.mobi/uploads/2026-01/test-xyz.png', written: 4 },
            payloadCaptor,
        })
        const io = makeFakeIo('sock-up-m', socket)
        const registry = makeFakeRegistry(new Map([['M1:writeFileRange', 'sock-up-m']]))

        const gateway = new RpcGateway(io, registry)
        const chunk = new Uint8Array([10, 20, 30, 40])
        const result = await gateway.machineUploadFileRange('M1', '/home/user/projects', 't.png', undefined, 0, chunk, 4)

        expect(result.success).toBe(true)
        expect(result.path).toBe('.mobi/uploads/2026-01/test-xyz.png')

        const envelope = payloadCaptor.value as { method: string; params: Record<string, unknown> }
        expect(envelope.method).toBe('M1:writeFileRange')
        expect(envelope.params.cwd).toBe('/home/user/projects')
        expect(envelope.params.filename).toBe('t.png')
        expect(envelope.params.content).toBe(chunk)
    })
})

// mock 标记：保留 import 避免被 lint 当未使用（本测试用自建 fake，未直接用 mock）
void mock
