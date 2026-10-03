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
 * ticket-17 组1 契约测试：LocalMachineHost 直调 vs SocketMachineHost 走真 handler 的
 * socket 回路，同输入必须同回执（成功 / 路径越界 / 文件不存在三形态）。
 *
 * socket 侧不是预设回包的 fake——emitWithAck 进真 RpcHandlerManager.handleRequest，
 * 注册的是 registerMachineFileHandlers / path-exists 的生产 handler；两侧唯一差别
 * 是「传输走 socket 回路」还是「本地函数调用」，分歧即契约破坏。
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { RpcHandlerManager } from '@mobi/node-core/rpc/RpcHandlerManager'
import { registerMachineFileHandlers } from '@mobi/node-core/handlers/machineFiles'
import { checkPathsExistImpl } from '@mobi/node-core/handlers/pathExists'
import { LocalMachineHost } from '../../../src/machine/LocalMachineHost'
import { SocketMachineHost } from '../../../src/machine/SocketMachineHost'
import { makeFakeIo, makeFakeRegistry } from '../sync/fakeTransport'

const MACHINE_ID = 'M-contract'
const HOME = homedir()

// socket 侧用真 handler：注册形态与 runner apiMachine 一致（machineFiles 覆盖式注册 + path-exists）
function makeServingPair(homeDir: string): { socketHost: SocketMachineHost } {
    const manager = new RpcHandlerManager({ scopePrefix: MACHINE_ID })
    registerMachineFileHandlers(manager, homeDir)
    manager.registerHandler('path-exists', (params: unknown) => checkPathsExistImpl(params))

    // serving socket：emitWithAck 直送 RpcHandlerManager（socket.io 回路的最小等价物）
    const socket = {
        timeout() {
            return this
        },
        async emitWithAck(_event: string, payload: unknown) {
            return await manager.handleRequest(payload as { method: string; params: unknown })
        },
    }
    const io = makeFakeIo('sock-contract', socket as never)
    const registry = makeFakeRegistry(new Map([
        [`${MACHINE_ID}:readFileMeta`, 'sock-contract'],
        [`${MACHINE_ID}:readFileRange`, 'sock-contract'],
        [`${MACHINE_ID}:path-exists`, 'sock-contract'],
    ]))
    return { socketHost: new SocketMachineHost(io, registry) }
}

describe('LocalMachineHost 契约（组1 文件读：直调 ≡ socket 回路）', () => {
    let tmpRoot: string
    let localHost: LocalMachineHost
    let socketHost: SocketMachineHost

    beforeAll(async () => {
        // home 子树内的临时工作区（读边界允许域；避开 .mobi 黑名单前缀）
        tmpRoot = join(HOME, `mobi-lmh-contract-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        await mkdir(join(tmpRoot, 'sub'), { recursive: true })
        await writeFile(join(tmpRoot, 'hello.txt'), '0123456789abcdef', 'utf-8')

        localHost = new LocalMachineHost({} as never) // 组1 方法不落 fallback，兜底不需要真实现
        socketHost = makeServingPair(HOME).socketHost
    })

    afterAll(async () => {
        await rm(tmpRoot, { recursive: true, force: true })
    })

    test('checkPathsExist：目录 / 文件（仅目录算 exists）/ 不存在三态一致', async () => {
        const paths = [tmpRoot, join(tmpRoot, 'hello.txt'), join(tmpRoot, 'no-such-dir'), '  ']
        expect(await localHost.checkPathsExist(MACHINE_ID, paths))
            .toEqual(await socketHost.checkPathsExist(MACHINE_ID, paths))
    })

    test('machineReadFileMeta：成功（meta/writable 同构）', async () => {
        expect(await localHost.machineReadFileMeta(MACHINE_ID, tmpRoot, 'hello.txt'))
            .toEqual(await socketHost.machineReadFileMeta(MACHINE_ID, tmpRoot, 'hello.txt'))
    })

    test('machineReadFileMeta：路径越界（home 外绝对路径）→ ACCESS_DENIED 同构', async () => {
        expect(await localHost.machineReadFileMeta(MACHINE_ID, tmpRoot, '/System/escape.txt'))
            .toEqual(await socketHost.machineReadFileMeta(MACHINE_ID, tmpRoot, '/System/escape.txt'))
    })

    test('machineReadFileMeta：敏感文件（黑名单）→ ACCESS_DENIED 同构', async () => {
        expect(await localHost.machineReadFileMeta(MACHINE_ID, tmpRoot, '../../.ssh/id_rsa'))
            .toEqual(await socketHost.machineReadFileMeta(MACHINE_ID, tmpRoot, '../../.ssh/id_rsa'))
    })

    test('machineReadFileMeta：文件不存在 → ENOENT 同构', async () => {
        const local = await localHost.machineReadFileMeta(MACHINE_ID, tmpRoot, 'missing.txt')
        const socket = await socketHost.machineReadFileMeta(MACHINE_ID, tmpRoot, 'missing.txt')
        expect(local).toEqual(socket)
        expect((local as { code?: string }).code).toBe('ENOENT')
    })

    test('machineReadFileRange：成功分片（含跨子目录相对路径）', async () => {
        expect(await localHost.machineReadFileRange(MACHINE_ID, tmpRoot, 'hello.txt', 4, 8))
            .toEqual(await socketHost.machineReadFileRange(MACHINE_ID, tmpRoot, 'hello.txt', 4, 8))
    })

    test('machineReadFileRange：越界路径拒绝同构', async () => {
        expect(await localHost.machineReadFileRange(MACHINE_ID, tmpRoot, '/System/escape.txt', 0, 4))
            .toEqual(await socketHost.machineReadFileRange(MACHINE_ID, tmpRoot, '/System/escape.txt', 0, 4))
    })
})
