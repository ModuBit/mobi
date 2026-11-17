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

import { SyncEngine } from '../../../src/sync/syncEngine'
import { MessageService } from '../../../src/sync/messageService'
import { Store } from '../../../src/store'
import type { RpcRegistry } from '../../../src/socket/rpcRegistry'
import type { SkillInventoryChangedEvent } from '../../../src/sync/skillInventoryBus'

/**
 * reload 命令观测（/reload-skills、/reload-plugins → skill-inventory-changed 事件）：
 * - 受理侧（MessageService.sendMessage → observeReloadCommandText）：startsWith 检测，
 *   受理即发布（已知时序特性：受理刻 CC 尚未执行完 reload，该次刷新可能拿旧值，
 *   收敛由 SWR 兜底 + 等价闸保证——重复刷新幂等无副作用）
 * - 事件总线统一消费（SdkMetadataRefresher.refreshInventory）：按事件作用面圈定活跃会话
 */

function makeEngine(): { engine: SyncEngine; store: Store; cleanup: () => void } {
    const store = new Store(':memory:')
    const io = { of() { return { sockets: new Map() } } } as unknown as import('socket.io').Server
    const registry = { getSocketIdForMethod() { return null } } as unknown as RpcRegistry
    const sseManager = { broadcast: () => {} } as unknown as import('../../../src/sse/sseManager').SSEManager
    const engine = new SyncEngine(store, io, registry, sseManager)
    return { engine, store, cleanup: () => { engine.stop(); store.close() } }
}

describe('reload 命令观测 → skill-inventory-changed 事件', () => {
    test('受理 /reload-skills → 立即发布事件（target 圈定发起会话自身）', () => {
        const h = makeEngine()
        try {
            const session = h.engine.getOrCreateSession('reload-1', { path: '/tmp/proj', host: 'h-1' }, null, 'default')
            const events: SkillInventoryChangedEvent[] = []
            h.engine.skillInventory.subscribe(e => events.push(e))

            h.engine.observeReloadCommandText(session.id, '/reload-skills')
            expect(events.length).toBe(1)
            expect(events[0]!.type).toBe('skill-inventory-changed')
            expect(events[0]!.namespace).toBe(session.namespace)
            expect(events[0]!.target).toEqual({ kind: 'session', sessionId: session.id })
        } finally {
            h.cleanup()
        }
    })

    test('/reload-plugins 带参数（startsWith）→ 触发', () => {
        const h = makeEngine()
        try {
            const session = h.engine.getOrCreateSession('reload-2', { path: '/tmp/proj', host: 'h-1' }, null, 'default')
            const events: SkillInventoryChangedEvent[] = []
            h.engine.skillInventory.subscribe(e => events.push(e))

            h.engine.observeReloadCommandText(session.id, '/reload-plugins --all')
            expect(events.length).toBe(1)
        } finally {
            h.cleanup()
        }
    })

    test('聊天内容提到命令名（非 startsWith）→ 不触发', () => {
        const h = makeEngine()
        try {
            const session = h.engine.getOrCreateSession('reload-3', { path: '/tmp/proj', host: 'h-1' }, null, 'default')
            const events: SkillInventoryChangedEvent[] = []
            h.engine.skillInventory.subscribe(e => events.push(e))

            h.engine.observeReloadCommandText(session.id, '你知道 /reload-skills 这个命令吗？')
            expect(events.length).toBe(0)
        } finally {
            h.cleanup()
        }
    })

    test('事件总线统一消费：按作用面圈定活跃会话（session 不外溢到同工作区）', async () => {
        const h = makeEngine()
        try {
            const workspace = h.store.workspaces.createWorkspace({
                namespace: 'default',
                name: 'W',
                folders: [{ path: '/tmp/a', primary: true }],
            })
            const wsId = workspace.id
            const session = h.engine.getOrCreateSession('reload-5', { path: '/tmp/a', host: 'h-1' }, null, 'default', 'local', undefined, wsId)
            const peer = h.engine.getOrCreateSession('reload-peer', { path: '/tmp/b', host: 'h-1' }, null, 'default', 'local', undefined, wsId)
            // 同 workspace 的 inactive 会话不应被刷
            const idle = h.engine.getOrCreateSession('reload-idle', { path: '/tmp/c', host: 'h-1' }, null, 'default', 'local', undefined, wsId)

            const refreshed: string[] = []
            h.engine.refreshMetadata = async (sessionId) => {
                refreshed.push(sessionId)
                return { success: false }
            }

            h.engine.handleSessionAlive({ sid: session.id, time: Date.now() })
            h.engine.handleSessionAlive({ sid: peer.id, time: Date.now() })
            await new Promise(r => setTimeout(r, 0))
            refreshed.length = 0 // 清掉激活补拉

            // global：全部活跃会话
            h.engine.skillInventory.emit({ type: 'skill-inventory-changed', namespace: 'default', target: { kind: 'global' } })
            await new Promise(r => setTimeout(r, 0))
            expect(refreshed.sort()).toEqual([session.id, peer.id].sort())
            expect(refreshed).not.toContain(idle.id)

            // workspace：圈定该工作区
            refreshed.length = 0
            h.engine.skillInventory.emit({
                type: 'skill-inventory-changed',
                namespace: 'default',
                target: { kind: 'workspace', workspaceId: wsId },
            })
            await new Promise(r => setTimeout(r, 0))
            expect(refreshed.sort()).toEqual([session.id, peer.id].sort())

            // session：只刷发起会话（D1：会话内 reload 不得外溢）
            refreshed.length = 0
            h.engine.skillInventory.emit({
                type: 'skill-inventory-changed',
                namespace: 'default',
                target: { kind: 'session', sessionId: session.id },
            })
            await new Promise(r => setTimeout(r, 0))
            expect(refreshed).toEqual([session.id])
        } finally {
            h.cleanup()
        }
    })
})

describe('MessageService 受理侧 reload 文本观测', () => {
    function makeMessageService() {
        const store = new Store(':memory:')
        const io = { of() { return { to: () => ({ emit: () => {} }) } } } as unknown as import('socket.io').Server
        const publisher = { emit: () => {} } as unknown as import('../../../src/sync/eventPublisher').EventPublisher
        const observed: Array<[string, string]> = []
        const service = new MessageService(store, io, publisher, (sid, text) => observed.push([sid, text]))
        return { store, service, observed, cleanup: () => store.close() }
    }

    test('纯文本命令消息 → 回调收到原文', async () => {
        const h = makeMessageService()
        try {
            const session = h.store.sessions.getOrCreateSession('ms-1', { path: '/tmp/proj', host: 'h-1' }, null, 'default')
            await h.service.sendMessage(session.id, { content: '/reload-skills' })
            expect(h.observed).toEqual([[session.id, '/reload-skills']])
        } finally {
            h.cleanup()
        }
    })

    test('多 text 块消息 → text 块拼接后检测', async () => {
        const h = makeMessageService()
        try {
            const session = h.store.sessions.getOrCreateSession('ms-2', { path: '/tmp/proj', host: 'h-1' }, null, 'default')
            await h.service.sendMessage(session.id, {
                content: [
                    { type: 'text', text: '帮我看下' },
                    { type: 'text', text: '/reload-plugins' },
                ],
            })
            expect(h.observed).toEqual([[session.id, '帮我看下\n/reload-plugins']])
        } finally {
            h.cleanup()
        }
    })
})
