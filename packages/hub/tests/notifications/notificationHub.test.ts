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
import { NotificationHub } from '../../src/notifications/notificationHub'
import type { SyncEvent } from '../../src/sync/syncEngine'

/** 构造 message-received(ready) 事件，模拟 CLI sendSessionEvent({type:'ready'}) 经 socket message → sessionHandlers → onWebappEvent 的产物 */
function makeReadyEvent(sessionId: string): SyncEvent {
    return {
        type: 'message-received',
        namespace: 'ns1',
        sessionId,
        message: {
            id: 'm1',
            seq: 1,
            localId: null,
            // CLI sendSessionEvent 构造的 content 结构：{type:'event', data:{type:'ready'}}
            content: { type: 'event', data: { type: 'ready' } },
            createdAt: Date.now(),
        },
    } as unknown as SyncEvent
}

describe('NotificationHub ready 链路（代码层确认）', () => {
    test('message-received(ready) 事件 → 触发 channel.sendReady', async () => {
        let registeredListener: ((e: SyncEvent) => void) | null = null
        const syncEngine = {
            subscribe: mock((listener: (e: SyncEvent) => void) => {
                registeredListener = listener
                return () => {}
            }),
            getSession: mock(() => ({ id: 's1', namespace: 'ns1', active: true, agentState: {} })),
        } as never
        const channel = {
            sendReady: mock(() => Promise.resolve()),
            sendPermissionRequest: mock(() => Promise.resolve()),
        }

        const hub = new NotificationHub(syncEngine, [channel as never])

        // 模拟 SyncEngine 派发 message-received(ready)
        registeredListener!(makeReadyEvent('s1'))
        // sendReadyNotification 是异步的，等微任务/定时器
        await new Promise(resolve => setTimeout(resolve, 50))

        expect(channel.sendReady).toHaveBeenCalledTimes(1)
        hub.stop()
    })

    test('非 ready 的 message-received 不触发 sendReady', async () => {
        let registeredListener: ((e: SyncEvent) => void) | null = null
        const syncEngine = {
            subscribe: mock((listener: (e: SyncEvent) => void) => {
                registeredListener = listener
                return () => {}
            }),
            getSession: mock(() => ({ id: 's1', namespace: 'ns1', active: true, agentState: {} })),
        } as never
        const channel = {
            sendReady: mock(() => Promise.resolve()),
            sendPermissionRequest: mock(() => Promise.resolve()),
        }

        const hub = new NotificationHub(syncEngine, [channel as never])

        // 普通 assistant 消息（type 不是 event），extractMessageEventType 返回 null
        registeredListener!({
            type: 'message-received',
            namespace: 'ns1',
            sessionId: 's1',
            message: {
                id: 'm2', seq: 2, localId: null,
                content: { type: 'text', data: 'hello' },
                createdAt: Date.now(),
            },
        } as unknown as SyncEvent)
        await new Promise(resolve => setTimeout(resolve, 50))

        expect(channel.sendReady).not.toHaveBeenCalled()
        hub.stop()
    })
})
