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

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/persistence', () => ({
    readSettings: vi.fn(),
    updateSettings: vi.fn(),
}))

import { readSettings, updateSettings } from '@/persistence'
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import type { RpcRequest } from '@/api/rpc/types'
import { registerDesktopConfigHandler } from '@/modules/common/handlers/desktopConfig'

const readSettingsMock = vi.mocked(readSettings)
const updateSettingsMock = vi.mocked(updateSettings)

function makeManager() {
    const manager = new RpcHandlerManager({ scopePrefix: 'machine-1' })
    return manager
}

async function callRpc(manager: RpcHandlerManager, method: string, params: unknown): Promise<unknown> {
    return await (manager as unknown as { handlers: Map<string, { handler: (p: unknown) => Promise<unknown> }> }).handlers
        .get(`machine-1:${method}`)!.handler(params)
}

beforeEach(() => {
    readSettingsMock.mockReset()
    updateSettingsMock.mockReset()
    updateSettingsMock.mockImplementation(async (updater) => {
        return updater({} as Parameters<typeof updater>[0])
    })
})

describe('registerDesktopConfigHandler', () => {
    it('set-desktop-vnc-password：合法密码经 updateSettings 落盘', async () => {
        const manager = makeManager()
        registerDesktopConfigHandler(manager)

        const result = await callRpc(manager, 'set-desktop-vnc-password', { vncPassword: 'ab12cd34' })

        expect(result).toEqual({ result: 'success' })
        expect(updateSettingsMock).toHaveBeenCalledTimes(1)
        const updater = updateSettingsMock.mock.calls[0]![0]
        const next = updater({ machineId: 'm' } as never)
        expect((next as { desktop?: { vncPassword?: string } }).desktop?.vncPassword).toBe('ab12cd34')
    })

    it('set-desktop-vnc-password：空串/超 8 字符被 schema 拒绝', async () => {
        const manager = makeManager()
        registerDesktopConfigHandler(manager)

        const empty = await callRpc(manager, 'set-desktop-vnc-password', { vncPassword: '' })
        const long = await callRpc(manager, 'set-desktop-vnc-password', { vncPassword: '123456789' })
        const missing = await callRpc(manager, 'set-desktop-vnc-password', {})

        expect(empty).toMatchObject({ result: 'error' })
        expect(long).toMatchObject({ result: 'error' })
        expect(missing).toMatchObject({ result: 'error' })
        expect(updateSettingsMock).not.toHaveBeenCalled()
    })

    it('get-desktop-vnc-status：已配置回 configured:true，不回密码', async () => {
        const manager = makeManager()
        registerDesktopConfigHandler(manager)
        readSettingsMock.mockResolvedValue({
            desktop: { vncPassword: 'secret1' },
        } as never)

        const result = await callRpc(manager, 'get-desktop-vnc-status', {})
        expect(result).toEqual({ result: 'success', configured: true })
        expect(JSON.stringify(result)).not.toContain('secret1')
    })

    it('get-desktop-vnc-status：未配置回 configured:false', async () => {
        const manager = makeManager()
        registerDesktopConfigHandler(manager)
        readSettingsMock.mockResolvedValue({} as never)

        const result = await callRpc(manager, 'get-desktop-vnc-status', {})
        expect(result).toEqual({ result: 'success', configured: false })
    })
})
