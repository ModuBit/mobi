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

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Store } from '../../src/store'

describe('setRuntimeState 时序', () => {
    let store: Store
    let sessionId: string

    beforeEach(() => {
        store = new Store(':memory:')
        sessionId = store.sessions.getOrCreateSession(
            'test-runtime-state',
            { name: 'test' },
            null,
            'default'
        ).id
    })

    afterEach(() => {
        store.close()
    })

    /** 读取当前 runtimeState */
    function readState(): Record<string, unknown> {
        return store.sessions.getSession(sessionId)!.runtimeState as Record<string, unknown>
    }

    test('同一毫秒内的第二次写入不应被丢弃', () => {
        // 同一 assistant turn 内的多个 TaskUpdate 会落在同一毫秒
        const t = Date.now()
        expect(store.sessions.setRuntimeState(
            sessionId, { tasks: [{ id: '1', status: 'in_progress' }] }, t, 'default'
        )).toBe(true)

        const second = store.sessions.setRuntimeState(
            sessionId, { tasks: [{ id: '1', status: 'completed' }] }, t, 'default'
        )
        expect(second).toBe(true)
        expect((readState().tasks as Array<{ status: string }>)[0].status).toBe('completed')
    })

    test('乱序到达时后写入者胜出（last-writer-wins）', () => {
        // resume 重放会带来更老的 createdAt，但它承载的合并结果仍是最新的
        const t2 = Date.now()
        const t1 = t2 - 1000

        store.sessions.setRuntimeState(sessionId, { tasks: [{ id: '1', status: 'pending' }] }, t2, 'default')
        const older = store.sessions.setRuntimeState(
            sessionId, { tasks: [{ id: '1', status: 'completed' }] }, t1, 'default'
        )

        expect(older).toBe(true)
        expect((readState().tasks as Array<{ status: string }>)[0].status).toBe('completed')
    })

    test('连续多次同毫秒写入均生效，最终态为最后一次', () => {
        const t = Date.now()
        for (const status of ['pending', 'in_progress', 'completed']) {
            expect(store.sessions.setRuntimeState(
                sessionId, { tasks: [{ id: '1', status }] }, t, 'default'
            )).toBe(true)
        }
        expect((readState().tasks as Array<{ status: string }>)[0].status).toBe('completed')
    })

    test('每次写入都递增 seq，供 web 端增量同步', () => {
        const t = Date.now()
        store.sessions.setRuntimeState(sessionId, { tasks: [] }, t, 'default')
        const seq1 = store.sessions.getSession(sessionId)!.seq
        store.sessions.setRuntimeState(sessionId, { tasks: [{ id: '1' }] }, t, 'default')
        expect(store.sessions.getSession(sessionId)!.seq).toBeGreaterThan(seq1)
    })

    test('紧随 setRuntimeState 的 clearRuntimeStateFields 不因同毫秒失败', () => {
        // 自动清除逻辑（tasks/todos 全完成）紧跟写入发生，二者极易落在同一毫秒
        store.sessions.setRuntimeState(
            sessionId,
            { todos: [{ content: 'x', status: 'completed' }], model: 'sonnet' },
            Date.now(),
            'default'
        )
        expect(store.sessions.clearRuntimeStateFields(sessionId, ['todos'], 'default')).toBe(true)
        expect(readState().todos).toBeUndefined()
        expect(readState().model).toBe('sonnet')
    })

    test('会话不存在时返回 false', () => {
        expect(store.sessions.setRuntimeState(
            'no-such-session', { tasks: [] }, Date.now(), 'default'
        )).toBe(false)
    })

    test('namespace 不匹配时不写入', () => {
        expect(store.sessions.setRuntimeState(
            sessionId, { tasks: [{ id: 'x' }] }, Date.now(), 'other-namespace'
        )).toBe(false)
    })
})
