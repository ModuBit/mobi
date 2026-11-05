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
 * 归档页批量操作的展示侧逻辑（session-retention 票 08）：确认输入匹配规则
 * （组名 / DELETE）与逐条结果聚合。
 */

import { describe, it, expect } from 'vitest'

import { batchConfirmExpected, summarizeBatch } from '@/features/layout/archivedBatch'

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
