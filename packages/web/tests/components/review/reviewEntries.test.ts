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
 * 审查条目语义纯函数单测（审查重写 v2）：可展开判定（isDiffable）、档位可用性
 * （isTargetUnavailable）、Select 序列化键往返（parseTargetKey）。
 * 箭头显隐、Collapse 过滤、树面板联动、档位禁用共用这些口径——边界在这里锁死。
 */

import { describe, expect, it } from 'vitest'
import { isDiffable, isTargetUnavailable, parseTargetKey } from '@/components/review/reviewEntries'
import type { DiffTarget, ReviewFileEntry, ReviewOverview } from '@mobi/shared'

function entry(overrides: Partial<ReviewFileEntry> = {}): ReviewFileEntry {
    return { path: 'a.ts', kind: 'modify', additions: 2, deletions: 1, binary: false, untracked: false, oversized: false, previousPath: null, ...overrides }
}

const OVERVIEW: ReviewOverview = {
    unavailableScopes: { turn: false, uncommitted: false, unstaged: false, staged: false, commit: false },
    isGitRepository: true,
    scopes: { turn: { fileCount: 0, additions: 0, deletions: 0 }, uncommitted: null, unstaged: null, staged: null },
    truncated: false,
    targetGeneration: 1,
}

describe('isDiffable（可展开判定）', () => {
    it('文本 + 有行数变化 → 可展开', () => {
        expect(isDiffable(entry())).toBe(true)
    })

    it('零变化但 rename（有旧路径）→ 可展开', () => {
        expect(isDiffable(entry({ additions: 0, deletions: 0, kind: 'rename', previousPath: 'old.ts' }))).toBe(true)
    })

    it('二进制 → 不可展开（行数与旧路径都无关）', () => {
        expect(isDiffable(entry({ binary: true }))).toBe(false)
        expect(isDiffable(entry({ binary: true, previousPath: 'old.png', kind: 'rename' }))).toBe(false)
    })

    it('零变化且无旧路径 → 不可展开（如 mode-only 条目）', () => {
        expect(isDiffable(entry({ additions: 0, deletions: 0 }))).toBe(false)
    })
})

describe('isTargetUnavailable（档位可用性矩阵）', () => {
    it('各档位映射矩阵对应项；overview 未到不算不可用', () => {
        const target = (t: DiffTarget) => t
        expect(isTargetUnavailable(OVERVIEW, target({ kind: 'turn' }))).toBe(false)
        expect(isTargetUnavailable(OVERVIEW, target({ kind: 'worktree', area: 'staged' }))).toBe(false)
        expect(isTargetUnavailable(undefined, target({ kind: 'worktree', area: 'unstaged' }))).toBe(false)
    })

    it('非 git 矩阵：turn 可用（工具层降级源）、git 系全不可用', () => {
        const nonGit: ReviewOverview = {
            ...OVERVIEW,
            isGitRepository: false,
            unavailableScopes: { turn: false, uncommitted: true, unstaged: true, staged: true, commit: true },
        }
        expect(isTargetUnavailable(nonGit, { kind: 'turn' })).toBe(false)
        expect(isTargetUnavailable(nonGit, { kind: 'worktree', area: 'uncommitted' })).toBe(true)
        expect(isTargetUnavailable(nonGit, { kind: 'commit', range: { base: 'a', head: 'b' } })).toBe(true)
    })
})

describe('parseTargetKey（Select 序列化键往返）', () => {
    it('三种 kind 往返一致；损坏输入抛错', () => {
        for (const t of [
            { kind: 'turn' } as DiffTarget,
            { kind: 'turn', turnIndex: 3 } as DiffTarget,
            { kind: 'worktree', area: 'uncommitted' } as DiffTarget,
            { kind: 'commit', range: { base: 'a', head: 'b' } } as DiffTarget,
        ]) {
            expect(parseTargetKey(JSON.stringify(t))).toEqual(t)
        }
        expect(() => parseTargetKey('not json')).toThrow()
        expect(() => parseTargetKey(JSON.stringify({ kind: 'branch' }))).toThrow()
    })
})
