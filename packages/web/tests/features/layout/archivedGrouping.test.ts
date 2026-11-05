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
 * 归档页分组形态：Listy 的 group 按键聚类重排 items——标注必须在「同组连续」的
 * 输入序上计算才与视觉一致。覆盖：交错序聚类、组间排序（最近归档的组在前）、
 * 组内边界标注、null 组键（未归入工作区）。
 */

import { describe, it, expect } from 'vitest'

import { groupAndAnnotate, archivedGroupKey } from '@/features/layout/archivedGrouping'
import type { Session } from '@/core/data/api/types'

function makeSession(id: string, workspaceId?: string): Session {
    return {
        id,
        namespace: 'ns',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: false,
        activeAt: 1,
        metadata: { path: '/x', host: 'h', name: id },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        running: false,
        runningAt: 1,
        status: 'archived',
        archivedAt: 1,
        workspaceId,
    }
}

describe('archivedGroupKey', () => {
    it('未归入工作区（undefined）折叠为 null 组键', () => {
        expect(archivedGroupKey(makeSession('a'))).toBeNull()
        expect(archivedGroupKey(makeSession('b', 'ws-1'))).toBe('ws-1')
    })
})

describe('groupAndAnnotate', () => {
    it('交错序聚类成组区块连续（Listy 重排退化为恒等的前提）', () => {
        // 全局时间倒序下 A/B 深度交错：A1 B1 A2 B2 A3
        const rows = groupAndAnnotate([
            makeSession('A1', 'ws-a'),
            makeSession('B1', 'ws-b'),
            makeSession('A2', 'ws-a'),
            makeSession('B2', 'ws-b'),
            makeSession('A3', 'ws-a'),
        ])
        expect(rows.map(r => r.session.id)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2'])
        // A 块：首标 first、中间无标、末标 last；B 块同理
        expect(rows.map(r => `${r.groupFirst ? 'F' : '-'}${r.groupLast ? 'L' : '-'}`))
            .toEqual(['F-', '--', '-L', 'F-', '-L'])
    })

    it('组间按首现位置排序（首行即组内最新归档 → 最近归档的组在前）', () => {
        const rows = groupAndAnnotate([
            makeSession('B1', 'ws-b'),
            makeSession('A1', 'ws-a'),
            makeSession('B2', 'ws-b'),
        ])
        expect(rows.map(r => r.session.id)).toEqual(['B1', 'B2', 'A1'])
    })

    it('单行组标 first+last（色块卡四角全圆的依据）', () => {
        const rows = groupAndAnnotate([
            makeSession('A1', 'ws-a'),
            makeSession('N1'),
            makeSession('A2', 'ws-a'),
        ])
        expect(rows.map(r => r.session.id)).toEqual(['A1', 'A2', 'N1'])
        expect(rows[2]).toMatchObject({ groupFirst: true, groupLast: true })
    })

    it('null 组（未归入工作区）与命名组互为异键、正确分块', () => {
        const rows = groupAndAnnotate([
            makeSession('N1'),
            makeSession('A1', 'ws-a'),
            makeSession('N2'),
        ])
        expect(rows.map(r => r.session.id)).toEqual(['N1', 'N2', 'A1'])
        expect(rows.map(r => `${r.groupFirst ? 'F' : '-'}${r.groupLast ? 'L' : '-'}`))
            .toEqual(['F-', '-L', 'FL'])
    })

    it('空输入返回空', () => {
        expect(groupAndAnnotate([])).toEqual([])
    })
})
