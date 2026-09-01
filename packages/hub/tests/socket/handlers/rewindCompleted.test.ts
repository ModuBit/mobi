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
import { registerSessionHandlers } from '../../../src/socket/handlers/cli/sessionHandlers'
import type { SessionHandlersDeps } from '../../../src/socket/handlers/cli/sessionHandlers'
import { BackgroundTaskTracker } from '../../../src/sync/backgroundTaskTracker'
import type { StoredSession } from '../../../src/store/types'
import type { SyncEvent } from '../../../src/sync/syncEngine'

/** 构造最小 StoredSession mock（仅含必要字段） */
function makeStoredSession(sid: string): StoredSession {
    return {
        id: sid, tag: null, namespace: 'default', machineId: null,
        createdAt: 1, updatedAt: 1, metadata: null, metadataVersion: 0,
        agentState: null, agentStateVersion: 0, runtimeState: null,
        runtimeStateUpdatedAt: null, projectId: null, pinned: false, seq: 1,
    }
}

/** 最小化 fake socket：按 event 名捕获 handler，便于直接触发 */
function makeFakeSocket() {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    return {
        on(event: string, handler: (...args: unknown[]) => void) {
            handlers.set(event, handler)
        },
        to() {
            return { emit() {} }
        },
        emit(event: string, ...args: unknown[]) {
            handlers.get(event)?.(...args)
        },
    }
}

/** 构造 SessionHandlersDeps，注入可控的 onWebappEvent 捕获 SSE 事件 */
function makeDeps(): { deps: SessionHandlersDeps; events: SyncEvent[] } {
    const events: SyncEvent[] = []
    const deps: SessionHandlersDeps = {
        store: {
            messages: {},
        } as unknown as SessionHandlersDeps['store'],
        resolveSessionAccess: (_sid: string) => ({ ok: true as const, value: makeStoredSession('s1') }),
        emitAccessError: () => {},
        backgroundTaskTracker: new BackgroundTaskTracker(),
        onWebappEvent: (e: SyncEvent) => { events.push(e) },
    }
    return { deps, events }
}

describe('rewind-completed handler：skippedLinks 透传', () => {
    test('带 skippedLinks → SSE event 含 skippedLinks', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, events } = makeDeps()

        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)
        fakeSocket.emit('rewind-completed', { sid: 's1', filesRestored: true, skippedLinks: 3 })

        expect(events).toHaveLength(1)
        const evt = events[0] as Extract<SyncEvent, { type: 'rewind-completed' }>
        expect(evt.type).toBe('rewind-completed')
        expect(evt.sessionId).toBe('s1')
        expect(evt.filesRestored).toBe(true)
        expect(evt.skippedLinks).toBe(3)
    })

    test('不带 skippedLinks → SSE event skippedLinks 为 undefined', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, events } = makeDeps()

        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)
        fakeSocket.emit('rewind-completed', { sid: 's1', filesRestored: false, error: 'boom' })

        expect(events).toHaveLength(1)
        const evt = events[0] as Extract<SyncEvent, { type: 'rewind-completed' }>
        expect(evt.type).toBe('rewind-completed')
        expect(evt.filesRestored).toBe(false)
        expect(evt.error).toBe('boom')
        expect(evt.skippedLinks).toBeUndefined()
    })

    test('skippedLinks: 0 → 正常透传（非 truthy 也透传）', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, events } = makeDeps()

        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)
        fakeSocket.emit('rewind-completed', { sid: 's1', filesRestored: true, skippedLinks: 0 })

        expect(events).toHaveLength(1)
        const evt = events[0] as Extract<SyncEvent, { type: 'rewind-completed' }>
        expect(evt.skippedLinks).toBe(0)
    })
})
