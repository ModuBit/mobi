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

import { describe, it, expect } from 'vitest'
import { toggleIdInPages } from '@/core/data/cache/pinnedOptimistic'
import type { ProjectSessionsPage } from '@/core/data/api/types'

function makeData(...pages: Array<Partial<ProjectSessionsPage>>) {
    return {
        pages: pages.map(p => ({
            sessionIds: p.sessionIds ?? [],
            nextCursor: p.nextCursor ?? null,
            hasMore: p.hasMore ?? false,
            total: p.total ?? 0,
        })),
        pageParams: [undefined],
    }
}

describe('toggleIdInPages（置顶乐观更新的分组成员调整）', () => {
    it('add：插入首页首位，全页 total 同步 +1（total 是分组全局数，消费方读最后一页）', () => {
        const data = makeData({ sessionIds: ['s1', 's2'], total: 2 }, { sessionIds: ['s3'], total: 3 })

        const next = toggleIdInPages(data, 'sx', true)!

        expect(next.pages[0].sessionIds).toEqual(['sx', 's1', 's2'])
        expect(next.pages[0].total).toBe(3)
        // 非首页 sessionIds 不动，仅 total 同步（与 remove 分支对称，避免「还剩 N」失真）
        expect(next.pages[1].sessionIds).toEqual(['s3'])
        expect(next.pages[1].total).toBe(4)
    })

    it('add：已存在则幂等返回原引用', () => {
        const data = makeData({ sessionIds: ['s1'], total: 1 })
        expect(toggleIdInPages(data, 's1', true)).toBe(data)
    })

    it('remove：从所有页移除并 total-1', () => {
        const data = makeData({ sessionIds: ['s1', 'sx'], total: 2 }, { sessionIds: ['sx', 's3'], total: 3 })

        const next = toggleIdInPages(data, 'sx', false)!

        expect(next.pages[0].sessionIds).toEqual(['s1'])
        expect(next.pages[0].total).toBe(1)
        expect(next.pages[1].sessionIds).toEqual(['s3'])
        expect(next.pages[1].total).toBe(2)
    })

    it('remove：不存在则幂等返回原引用', () => {
        const data = makeData({ sessionIds: ['s1'], total: 1 })
        expect(toggleIdInPages(data, 'sx', false)).toBe(data)
    })

    it('data 存在但 pages 为空（查询刚 reset）：原样返回，交给 invalidate 补偿（不捏造与真值无关的假页）', () => {
        const data = makeData()
        expect(toggleIdInPages(data, 'sx', true)).toBe(data)
    })

    it('缓存未拉过（undefined）：原样返回，交给 invalidate 补偿', () => {
        expect(toggleIdInPages(undefined, 'sx', true)).toBeUndefined()
        expect(toggleIdInPages(undefined, 'sx', false)).toBeUndefined()
    })
})
