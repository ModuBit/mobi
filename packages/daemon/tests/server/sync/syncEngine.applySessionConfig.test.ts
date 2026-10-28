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
import type { SyncEvent } from '@mobi/shared/types'
import { SyncEngine } from '../../../src/sync/syncEngine'
import { Store } from '../../../src/store'
import type { SSEManager } from '../../../src/sse/sseManager'
import { makeFakeIo, makeFakeRegistry, makeFakeSocket } from './fakeTransport'

/**
 * 会话配置 RPC 的**回执核对**。
 *
 * 会话进程活得比 daemon 久：换二进制不重启会话时，CLI 侧还是旧代码。旧代码不认识
 * 后加的配置字段（如 2026-10-27 才落地的 fastMode），`set-session-config` 会把它
 * 原样忽略、只回它认识的字段——daemon 若照单全收，链路就是「HTTP 200、界面毫无变化、
 * 也没有任何报错」，用户看到的是「点了没反应」（2026-10-28 真机：Oct 25 起的会话
 * 进程点闪电钮无反应，DB 里 runtimeState.fastMode 从未出现）。
 */
function makeEngine(response: unknown) {
    const store = new Store(':memory:')
    const events: SyncEvent[] = []
    const sseManager = { broadcast: (event: SyncEvent) => { events.push(event) } } as unknown as SSEManager

    const payloadCaptor = { value: undefined as unknown }
    const socket = makeFakeSocket({ response, payloadCaptor })
    const io = makeFakeIo('sock-cfg-1', socket)
    const methods = new Map<string, string | null>()

    const engine = new SyncEngine(store, io, makeFakeRegistry(methods), sseManager)
    const session = engine.getOrCreateSession('tag-cfg-1', { path: '/tmp/cfg' }, null, 'default')
    methods.set(`${session.id}:set-session-config`, 'sock-cfg-1')
    events.length = 0

    return {
        engine,
        session,
        events,
        payloadCaptor,
        cleanup: () => {
            engine.stop()
            store.close()
        },
    }
}

describe('SyncEngine.applySessionConfig 回执核对', () => {
    test('CLI 回执里没有请求的字段（旧会话进程）→ 报错且不写 runtimeState', async () => {
        // 旧 CLI 的 applied 只有三个老字段
        const h = makeEngine({ applied: { permissionMode: 'default', model: null, effort: 'medium' } })
        try {
            const error = await h.engine.applySessionConfig(h.session.id, { fastMode: true }).then(
                () => null,
                (err: unknown) => err,
            )

            expect(error).toBeInstanceOf(Error)
            const message = (error as Error).message
            expect(message).toContain('fastMode')
            expect(message).toMatch(/restart/i)
            // 没写进 runtimeState，也没广播「配置已变」
            expect(h.events.filter(e => e.type === 'session-updated')).toHaveLength(0)
        } finally {
            h.cleanup()
        }
    })

    test('CLI 回执完整 → 照旧落库并广播', async () => {
        const h = makeEngine({ applied: { permissionMode: 'default', model: null, effort: 'medium', fastMode: true } })
        try {
            await h.engine.applySessionConfig(h.session.id, { fastMode: true })

            // 请求原样下发给 CLI
            expect(h.payloadCaptor.value).toMatchObject({ params: { fastMode: true } })

            const updated = h.events.find(e => e.type === 'session-updated') as
                | { data: { runtimeState?: { fastMode?: boolean } } }
                | undefined
            expect(updated?.data.runtimeState?.fastMode).toBe(true)
        } finally {
            h.cleanup()
        }
    })
})
