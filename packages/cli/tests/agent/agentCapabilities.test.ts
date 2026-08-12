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

import { describe, test, expect, vi, afterEach } from 'vitest'

// logger 仅打日志，mock 掉避免依赖链
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }))

import {
    registerAgentCapabilities,
    syncAgentRename,
    type AgentCapabilities,
    type AgentSessionLocator,
} from '@/agent/agentCapabilities'

describe('syncAgentRename (agent 无关 capability registry)', () => {
    const unregisterHandles: Array<() => void> = []

    afterEach(() => {
        // 卸载本轮注册的所有 capability，保证测试间 registry 隔离
        for (const unregister of unregisterHandles) unregister()
        unregisterHandles.length = 0
    })

    /** 注册并记录卸载句柄，afterEach 自动清理 */
    function register(flavor: string, caps: AgentCapabilities) {
        const unregister = registerAgentCapabilities(flavor, caps)
        unregisterHandles.push(unregister)
        return unregister
    }

    test('按 locator.flavor 找到注册的 capability 并调用 renameSession', async () => {
        const renameFn = vi.fn().mockResolvedValue(undefined)
        register('test-agent-ok', { renameSession: renameFn })

        const locator: AgentSessionLocator = {
            flavor: 'test-agent-ok',
            sessionId: 's-1',
            path: '/tmp/proj',
        }
        await syncAgentRename(locator, '新标题')

        expect(renameFn).toHaveBeenCalledOnce()
        expect(renameFn).toHaveBeenCalledWith(locator, '新标题')
    })

    test('locator 为 null → throw（会话未就绪）', async () => {
        await expect(syncAgentRename(null, '标题')).rejects.toThrow(/not ready/)
    })

    test('sessionId 为 null → throw（会话未就绪）', async () => {
        await expect(
            syncAgentRename({ flavor: 'x', sessionId: null, path: '/tmp' }, '标题')
        ).rejects.toThrow(/not ready/)
    })

    test('flavor 未注册 → throw', async () => {
        await expect(
            syncAgentRename({ flavor: 'unregistered-agent', sessionId: 's', path: '/tmp' }, 't')
        ).rejects.toThrow(/does not support rename/)
    })

    test('flavor 已注册但无 renameSession 能力 → throw', async () => {
        register('no-rename-agent', {}) // 有 capability 但没实现 rename
        await expect(
            syncAgentRename({ flavor: 'no-rename-agent', sessionId: 's', path: '/tmp' }, 't')
        ).rejects.toThrow(/does not support rename/)
    })

    test('卸载函数移除注册，之后调用 throw', async () => {
        const renameFn = vi.fn().mockResolvedValue(undefined)
        const unregister = register('temp-agent', { renameSession: renameFn })

        unregister()

        await expect(
            syncAgentRename({ flavor: 'temp-agent', sessionId: 's', path: '/tmp' }, 't')
        ).rejects.toThrow(/does not support rename/)
        expect(renameFn).not.toHaveBeenCalled()
    })

    test('重复注册同一 flavor 以最新覆盖', async () => {
        const fn1 = vi.fn().mockResolvedValue(undefined)
        const fn2 = vi.fn().mockResolvedValue(undefined)
        register('override-agent', { renameSession: fn1 })
        register('override-agent', { renameSession: fn2 })

        await syncAgentRename({ flavor: 'override-agent', sessionId: 's', path: '/tmp' }, 't')

        expect(fn1).not.toHaveBeenCalled()
        expect(fn2).toHaveBeenCalledOnce()
    })
})
