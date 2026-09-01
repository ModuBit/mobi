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

import { createPermissionsRoutes } from '../../src/web/routes/permissions'
import type { SyncEngine } from '../../src/sync/syncEngine'
import type { Session } from '@mobi/shared'

const mockSession: Session = {
    id: 'test-session-1',
    namespace: 'default',
    seq: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    active: true,
    activeAt: Date.now(),
    metadata: { path: '/tmp/test', host: 'test-host', flavor: 'claude' },
    metadataVersion: 1,
    // agentState 为空：requestId 校验必然命中「request 已被处理」分支
    // （返回 404 permission_request_gone），路由聚焦 zod schema 放行与否的断言
    agentState: null,
    agentStateVersion: 0,
    running: false,
    runningAt: Date.now(),
    permissionMode: 'default',
}

function makeEngine(): SyncEngine {
    return {
        resolveSessionAccess: (id: string) => ({
            ok: true as const,
            sessionId: id,
            session: { ...mockSession, id },
        }),
    } as unknown as SyncEngine
}

function makeApp(): ReturnType<typeof createPermissionsRoutes> {
    return createPermissionsRoutes(() => makeEngine())
}

async function postApprove(body: unknown): Promise<Response> {
    const app = makeApp()
    return app.request('/sessions/test-session-1/permissions/req-gone/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
}

/** schema 拒绝返回 400，requestId 校验返回 404 permission_request_gone——两者可区分 */
async function expectSchemaPassed(res: Response): Promise<void> {
    expect(res.status).toBe(404)
    const json = (await res.json()) as { error: string; code?: string }
    expect(json.code).toBe('permission_request_gone')
}

// ============ 批次 C：answers 通道放宽 number/boolean（spec D3）============

describe('approve answers 通道放宽', () => {
    test('answers 值接受 number 与 boolean（elicitation 表单值）', async () => {
        const res = await postApprove({ answers: { count: 3, enabled: true, name: 'x' } })
        await expectSchemaPassed(res)
    })

    test('既有 flat string/string[] 格式仍放行（无回归）', async () => {
        const res = await postApprove({ answers: { color: 'red', tags: ['a', 'b'] } })
        await expectSchemaPassed(res)
    })

    test('既有嵌套 { answers: string[] } 格式仍放行（无回归）', async () => {
        const res = await postApprove({ answers: { q1: { answers: ['a', 'b'] } } })
        await expectSchemaPassed(res)
    })

    test('flat 格式内 number/boolean/string/string[] 任意混合全放行', async () => {
        const res = await postApprove({
            answers: {
                port: 8080,
                debug: false,
                owner: 'mobi',
                topics: ['x', 'y'],
            },
        })
        await expectSchemaPassed(res)
    })

    test('union 语义：flat 与嵌套不可混于同一对象 → 400（schema 既定行为）', async () => {
        const res = await postApprove({
            answers: { port: 8080, q1: { answers: ['a'] } },
        })
        expect(res.status).toBe(400)
    })

    test('非法 answers 值类型（对象非嵌套格式）仍拒绝 → 400', async () => {
        const res = await postApprove({ answers: { bad: { other: 'x' } } })
        expect(res.status).toBe(400)
    })
})
