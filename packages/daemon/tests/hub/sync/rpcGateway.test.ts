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
import type { PermissionUpdate } from '@mobi/shared'
import { RpcGateway } from '../../../src/sync/rpcGateway'
import { makeFakeIo, makeFakeRegistry, makeFakeSocket } from './fakeTransport'

// 传输层（rpcCall）单测在 rpcCaller.test.ts；machine 族（spawnSession / uploadFileRange 等）
// 在 tests/hub/machine/SocketMachineHost.test.ts——ticket-15 拆分后各归其位

// ============ cancelCliQueuedMessage（两阶段取消的 CLI 侧 RPC） ============

describe('RpcGateway.cancelCliQueuedMessage', () => {
    test('正确调用 sessionRpc(sessionId, cancel-queued-message, {localId}) 并返回 status', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({
            response: { status: 'cancelled' },
            payloadCaptor,
        })
        const io = makeFakeIo('sock-cancel-1', socket)
        const registry = makeFakeRegistry(new Map([['sess-A:cancel-queued-message', 'sock-cancel-1']]))

        const gateway = new RpcGateway(io, registry)
        const result = await gateway.cancelCliQueuedMessage('sess-A', 'loc-1')

        expect(result).toEqual({ status: 'cancelled' })
        const envelope = payloadCaptor.value as { method: string; params: Record<string, unknown> }
        expect(envelope.method).toBe('sess-A:cancel-queued-message')
        expect(envelope.params).toEqual({ localId: 'loc-1' })
    })

    test('CLI 返回 submitted → 透传', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({
            response: { status: 'submitted' },
            payloadCaptor,
        })
        const io = makeFakeIo('sock-cancel-2', socket)
        const registry = makeFakeRegistry(new Map([['sess-B:cancel-queued-message', 'sock-cancel-2']]))

        const gateway = new RpcGateway(io, registry)
        const result = await gateway.cancelCliQueuedMessage('sess-B', 'loc-2')

        expect(result).toEqual({ status: 'submitted' })
    })

    test('CLI 无响应（res 为 null/undefined）→ 降级为 submitted', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({
            response: null,
            payloadCaptor,
        })
        const io = makeFakeIo('sock-cancel-3', socket)
        const registry = makeFakeRegistry(new Map([['sess-C:cancel-queued-message', 'sock-cancel-3']]))

        const gateway = new RpcGateway(io, registry)
        const result = await gateway.cancelCliQueuedMessage('sess-C', 'loc-3')

        expect(result).toEqual({ status: 'submitted' })
    })

    test('handler 未注册 → throw（CLI 不在线）', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({ response: {}, payloadCaptor })
        const io = makeFakeIo('sock-cancel-4', socket)
        const registry = makeFakeRegistry(new Map([['sess-D:cancel-queued-message', null]]))

        const gateway = new RpcGateway(io, registry)
        await expect(
            gateway.cancelCliQueuedMessage('sess-D', 'loc-4')
        ).rejects.toThrow(/not registered/)
    })
})

// ============ requestRename（Mobi → CC 标题同步 RPC） ============

describe('RpcGateway.requestRename', () => {
    test('正确调用 sessionRpc(sessionId, rename-session, {title}) 透传标题', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({ response: { ok: true }, payloadCaptor })
        const io = makeFakeIo('sock-rename-1', socket)
        const registry = makeFakeRegistry(new Map([['sess-rename:rename-session', 'sock-rename-1']]))

        const gateway = new RpcGateway(io, registry)
        await gateway.requestRename('sess-rename', '新标题')

        const envelope = payloadCaptor.value as { method: string; params: Record<string, unknown> }
        expect(envelope.method).toBe('sess-rename:rename-session')
        expect(envelope.params).toEqual({ title: '新标题' })
    })

    test('handler 未注册（CLI 不在线）→ throw', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({ response: {}, payloadCaptor })
        const io = makeFakeIo('sock-rename-2', socket)
        const registry = makeFakeRegistry(new Map([['sess-rename2:rename-session', null]]))

        const gateway = new RpcGateway(io, registry)
        await expect(gateway.requestRename('sess-rename2', '标题')).rejects.toThrow(/not registered/)
    })
})

// ============ approvePermission 转发 updatedPermissions ============

describe('RpcGateway.approvePermission', () => {
    test('updatedPermissions 塞进 permission RPC payload 并透传给 CLI', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({ response: { ok: true }, payloadCaptor })
        const io = makeFakeIo('sock-appr-1', socket)
        const registry = makeFakeRegistry(new Map([['sess-appr:permission', 'sock-appr-1']]))

        const gateway = new RpcGateway(io, registry)
        const updatedPermissions: PermissionUpdate[] = [
            {
                type: 'addRules',
                rules: [{ toolName: 'Bash', ruleContent: 'ls' }],
                behavior: 'allow',
                destination: 'session',
            },
        ]
        await gateway.approvePermission(
            'sess-appr',
            'req-1',
            undefined,
            'approved',
            undefined,
            updatedPermissions,
        )

        const envelope = payloadCaptor.value as { method: string; params: Record<string, unknown> }
        expect(envelope.method).toBe('sess-appr:permission')
        expect(envelope.params.id).toBe('req-1')
        expect(envelope.params.approved).toBe(true)
        // 关键：updatedPermissions 原样塞进 payload（替代旧的 allowTools）
        expect(envelope.params.updatedPermissions).toEqual(updatedPermissions)
        expect('allowTools' in envelope.params).toBe(false)
    })

    test('未传 updatedPermissions 时 payload 不含该字段', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({ response: { ok: true }, payloadCaptor })
        const io = makeFakeIo('sock-appr-2', socket)
        const registry = makeFakeRegistry(new Map([['sess-appr2:permission', 'sock-appr-2']]))

        const gateway = new RpcGateway(io, registry)
        await gateway.approvePermission('sess-appr2', 'req-2', undefined, 'approved', undefined, undefined)

        const envelope = payloadCaptor.value as { method: string; params: Record<string, unknown> }
        expect(envelope.params.id).toBe('req-2')
        // updatedPermissions 未传时 payload 中该字段为 undefined（原 allowTools 字段彻底移除）
        expect(envelope.params.updatedPermissions).toBeUndefined()
        expect('allowTools' in envelope.params).toBe(false)
    })
})
