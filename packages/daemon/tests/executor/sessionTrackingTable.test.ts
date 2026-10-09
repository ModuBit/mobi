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
 * 追踪表 module（架构评审候选⑧票①）的测试面 = 表行与等待端的同生共死：
 * webhook resolve / failAwaiter / remove / timeout 四路的配对清理——
 * 此前 6 处 delete 配对散在闭包各路径，漏一处就漏 resolve 或悬空回调。
 */

import { describe, it, expect, vi } from 'vitest'
import { SessionTrackingTable } from '@/executor/sessionTrackingTable'
import type { TrackedSession } from '@/executor/types'

function daemonRow(pid: number): TrackedSession {
    return { startedBy: 'daemon', pid } as TrackedSession
}

function webhookMetadata(pid: number) {
    return { hostPid: pid } as never
}

describe('SessionTrackingTable webhook ↔ 等待端', () => {
    it('webhook 命中 daemon 行 → 回填 MobiSessionId 并 resolve 等待端（success）', async () => {
        const table = new SessionTrackingTable()
        table.registerDaemon(daemonRow(100))
        const waiting = table.waitForWebhook(100, 1_000, () => 'timeout-msg')

        table.applyWebhook('sess-1', webhookMetadata(100))

        await expect(waiting).resolves.toEqual({ ok: true, sessionId: 'sess-1' })
        expect(table.get(100)?.MobiSessionId).toBe('sess-1')
    })

    it('webhook 外部会话（表无此 pid）→ 登记新行，不动已有等待端', () => {
        const table = new SessionTrackingTable()
        table.applyWebhook('ext-1', webhookMetadata(200))
        expect(table.get(200)?.startedBy).toBe('mobi directly - likely by user from terminal')
        expect(table.all()).toHaveLength(1)
    })

    it('webhook 缺 hostPid → 忽略不炸', () => {
        const table = new SessionTrackingTable()
        table.applyWebhook('x', {} as never)
        expect(table.all()).toHaveLength(0)
    })

    it('waitForWebhook 超时 → 失败文案来自 onTimeout 回调（stderr/exit 观测在编排侧）', async () => {
        const table = new SessionTrackingTable()
        table.registerDaemon(daemonRow(300))
        const onTimeout = vi.fn(() => 'timed out with tail')
        const waiting = table.waitForWebhook(300, 10, onTimeout)

        await expect(waiting).resolves.toEqual({ ok: false, errorMessage: 'timed out with tail' })
    })
})

describe('SessionTrackingTable 失败端与退场', () => {
    it('failAwaiter → resolve error；remove 连带清行与等待端', async () => {
        const table = new SessionTrackingTable()
        table.registerDaemon(daemonRow(400))
        const waiting = table.waitForWebhook(400, 5_000, () => 'timeout-msg')

        table.failAwaiter(400, 'exit-before-webhook')
        table.remove(400)

        await expect(waiting).resolves.toEqual({ ok: false, errorMessage: 'exit-before-webhook' })
        expect(table.get(400)).toBeUndefined()
    })

    it('remove 先于 waitForWebhook（exit 后挂等待端）→ 悬空等待端靠超时兜底（既有行为）', async () => {
        const table = new SessionTrackingTable()
        table.registerDaemon(daemonRow(500))
        table.failAwaiter(500, 'early-exit')
        table.remove(500)

        // exit 已处理完（failAwaiter+remove），后挂的等待端再无人 resolve——只有 timeout 路径兜底
        const waiting = table.waitForWebhook(500, 10, () => 'timeout-msg')
        await expect(waiting).resolves.toEqual({ ok: false, errorMessage: 'timeout-msg' })
    })

    it('无等待端时 failAwaiter 静默（不炸、不清行）', () => {
        const table = new SessionTrackingTable()
        table.registerDaemon(daemonRow(600))
        expect(() => table.failAwaiter(600, 'nobody-waiting')).not.toThrow()
        expect(table.get(600)).toBeDefined()
    })
})

describe('SessionTrackingTable 纯函数转发', () => {
    it('checkSpawnDedup 命中活行（决策单源在 spawnDedup，此处只验证接线）', () => {
        const table = new SessionTrackingTable()
        table.registerDaemon({ startedBy: 'daemon', pid: 700, resumeSessionId: 'resume-1' } as TrackedSession)
        const hit = table.checkSpawnDedup({ resumeSessionId: 'resume-1' })
        expect(hit).toBeDefined()
        expect(table.checkSpawnDedup({ resumeSessionId: 'no-such' })).toBeNull()
    })

    it('pruneDead 清死行并返回 pid（决策单源在 sessionTracking）', () => {
        const table = new SessionTrackingTable()
        // pid 999_999 极大概率不存在 → 视为死行
        table.registerDaemon(daemonRow(999_999))
        expect(table.pruneDead()).toContain(999_999)
        expect(table.get(999_999)).toBeUndefined()
    })
})
