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
 * 归档页批量操作逻辑（session-retention 票 08）：串行执行、单条失败不回滚整批、
 * 确认输入匹配规则（组名 / DELETE）。
 */

import { describe, it, expect, vi } from 'vitest'

import { runBatch, batchConfirmExpected, summarizeBatch } from '@/features/layout/archivedBatch'
import type { Session } from '@/core/data/api/types'

function makeSession(id: string, name = id): Session {
    return {
        id,
        namespace: 'ns',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: false,
        activeAt: 1,
        metadata: { path: '/x', host: 'h', name },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        running: false,
        runningAt: 1,
    } as Session
}

describe('runBatch', () => {
    it('逐条成功：全部 ok，onSuccess 每条回调', async () => {
        const action = vi.fn().mockResolvedValue(undefined)
        const onSuccess = vi.fn()
        const results = await runBatch([makeSession('a', 'A'), makeSession('b', 'B')], action, onSuccess)

        expect(results).toHaveLength(2)
        expect(results.every(r => r.ok)).toBe(true)
        expect(onSuccess).toHaveBeenCalledTimes(2)
        // 串行：第一条完成才发起第二条
        expect(action.mock.calls.map(c => c[0])).toEqual(['a', 'b'])
    })

    it('单条失败不回滚整批：失败项带原因，后续条目照常执行', async () => {
        const action = vi.fn((id: string) =>
            id === 'b' ? Promise.reject(new Error('EBUSY')) : Promise.resolve(undefined))
        const onSuccess = vi.fn()
        const results = await runBatch([makeSession('a', 'A'), makeSession('b', 'B'), makeSession('c', 'C')], action, onSuccess)

        const failed = results.filter(r => !r.ok)
        expect(failed).toHaveLength(1)
        expect(failed[0].sessionId).toBe('b')
        expect(failed[0].reason).toContain('EBUSY')
        // 成功条目已生效（onSuccess 覆盖 a 与 c）
        expect(onSuccess).toHaveBeenCalledTimes(2)
        expect(action).toHaveBeenCalledTimes(3)
    })

    it('汇总 name 用显示名（metadata.name）而非 id', async () => {
        const results = await runBatch([makeSession('a', '林墨墨的会话')], () => Promise.reject(new Error('x')))
        expect(results[0].name).toBe('林墨墨的会话')
    })
})

describe('batchConfirmExpected（删除确认输入匹配值）', () => {
    it('组级：项目名即匹配值', () => {
        expect(batchConfirmExpected({ kind: 'group', groupName: 'my-project' })).toBe('my-project')
    })

    it('组级：项目名为空白（未知工作区）回退 DELETE', () => {
        expect(batchConfirmExpected({ kind: 'group', groupName: '   ' })).toBe('DELETE')
    })

    it('页面级：DELETE', () => {
        expect(batchConfirmExpected({ kind: 'page' })).toBe('DELETE')
    })
})

describe('summarizeBatch（聚合文案）', () => {
    const t = ((key: string, opts?: Record<string, unknown>) => {
        if (key === 'ok') return `ok:${opts?.count}`
        if (key === 'fail') return `fail:${opts?.name}:${opts?.reason}`
        return key
    }) as never as (key: string, opts?: Record<string, unknown>) => string

    it('全成功：只有成功行', () => {
        const results = [
            { sessionId: 'a', name: 'A', ok: true },
            { sessionId: 'b', name: 'B', ok: true },
        ]
        expect(summarizeBatch(results, t, { successKey: 'ok', failedKey: 'fail' })).toBe('ok:2')
    })

    it('部分失败：成功行 + 逐条失败行', () => {
        const results = [
            { sessionId: 'a', name: 'A', ok: true },
            { sessionId: 'b', name: 'B', ok: false, reason: 'EBUSY' },
        ]
        const text = summarizeBatch(results, t, { successKey: 'ok', failedKey: 'fail' })
        expect(text).toContain('ok:1')
        expect(text).toContain('fail:B:EBUSY')
    })
})
