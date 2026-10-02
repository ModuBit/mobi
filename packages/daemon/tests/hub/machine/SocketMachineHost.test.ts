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
import { SocketMachineHost } from '../../../src/machine/SocketMachineHost'
import { RpcFailure } from '../../../src/sync/rpcFailure'
import { makeFakeIo, makeFakeRegistry, makeFakeSocket } from '../sync/fakeTransport'

// ============ ticket-15 验收：未注册 machine → RpcFailure(kind='unreachable') ============

describe('SocketMachineHost 未注册 machine', () => {
    test('对未注册 machine 的调用 → throw 带 unreachable 分类的 RpcFailure', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({ response: {}, payloadCaptor })
        const io = makeFakeIo('sock-real', socket)
        // registry 里没有 M-ghost 的任何 handler
        const registry = makeFakeRegistry(new Map([['M-other:list-directory', 'sock-real']]))

        const host = new SocketMachineHost(io, registry)
        const error = await host.listMachineDirectory('M-ghost', '/tmp', '/home/user')
            .catch((thrown: unknown) => thrown)

        expect(error).toBeInstanceOf(RpcFailure)
        expect((error as RpcFailure).kind).toBe('unreachable')
        expect((error as RpcFailure).message).toMatch(/M-ghost:list-directory/)
    })
})

// ============ machineUploadFileRange 二进制往返单测（自 rpcGateway.test 移入） ============

describe('SocketMachineHost.machineUploadFileRange', () => {
    test('cwd 透传到 writeFileRange', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({
            response: { success: true, path: '.mobi/uploads/2026-01/test-xyz.png', written: 4 },
            payloadCaptor,
        })
        const io = makeFakeIo('sock-up-m', socket)
        const registry = makeFakeRegistry(new Map([['M1:writeFileRange', 'sock-up-m']]))

        const host = new SocketMachineHost(io, registry)
        const chunk = new Uint8Array([10, 20, 30, 40])
        const result = await host.machineUploadFileRange('M1', '/home/user/workspaces', 't.png', undefined, 0, chunk, 4)

        expect(result.success).toBe(true)
        expect(result.path).toBe('.mobi/uploads/2026-01/test-xyz.png')

        const envelope = payloadCaptor.value as { method: string; params: Record<string, unknown> }
        expect(envelope.method).toBe('M1:writeFileRange')
        expect(envelope.params.cwd).toBe('/home/user/workspaces')
        expect(envelope.params.filename).toBe('t.png')
        expect(envelope.params.content).toBe(chunk)
    })
})

// ============ spawnSession 的失败分类（分类在产生它的这一层定下；自 rpcGateway.test 移入） ============

describe('SocketMachineHost.spawnSession — 失败支带传输分类', () => {
    /** 让 runner 对这个 spawn RPC 回一个预设响应 */
    function hostReplying(response: unknown): SocketMachineHost {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({ response, payloadCaptor })
        const io = makeFakeIo('sock-spawn', socket)
        return new SocketMachineHost(io, makeFakeRegistry(new Map([['M1:spawn-mobi-session', 'sock-spawn']])))
    }

    test('runner 等会话 webhook 超时 → timeout（这条句子跨进程，只能照文案认）', async () => {
        const host = hostReplying({ type: 'error', errorMessage: 'Session webhook timeout for PID 4242' })

        expect(await host.spawnSession('M1', '/work/app')).toEqual({
            type: 'error',
            message: 'Session webhook timeout for PID 4242',
            failure: 'timeout',
        })
    })

    test('runner 自己的人话（目录建不出来）→ other，句子原样透出', async () => {
        const upstream = "Unable to create directory at '/work/app'. A file already exists at this path or in the parent path."
        const host = hostReplying({ type: 'error', errorMessage: upstream })

        expect(await host.spawnSession('M1', '/work/app')).toEqual({
            type: 'error',
            message: upstream,
            failure: 'other',
        })
    })

    test('通道不可达（registry 没这个 handler）→ unreachable（分类随异常带到失败支）', async () => {
        const payloadCaptor = { value: undefined as unknown }
        const socket = makeFakeSocket({ response: {}, payloadCaptor })
        const io = makeFakeIo('sock-x', socket)
        const host = new SocketMachineHost(io, makeFakeRegistry(new Map([['M2:spawn-mobi-session', null]])))

        expect(await host.spawnSession('M2', '/work/app')).toEqual({
            type: 'error',
            message: 'RPC handler not registered: M2:spawn-mobi-session',
            failure: 'unreachable',
        })
    })

    test('认不出的回执 → other + 原样说明（不编分类）', async () => {
        const host = hostReplying({ weird: true })

        expect(await host.spawnSession('M1', '/work/app')).toEqual({
            type: 'error',
            message: 'Unexpected spawn result: {"weird":true}',
            failure: 'other',
        })
    })
})
