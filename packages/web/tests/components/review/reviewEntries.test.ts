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
 * 审查条目语义纯函数单测：可展开判定（isDiffable）与单文件查询组装（fileQueryFor）。
 * 箭头显隐、Collapse 过滤、树面板联动、行内 diff 查询共用这两个口径——边界在这里锁死。
 */

import { describe, expect, it } from 'vitest'
import type { TurnDiffFileEntry } from '@mobi/shared'
import { fileQueryFor, isDiffable } from '@/components/review/reviewEntries'

function entry(overrides: Partial<TurnDiffFileEntry> = {}): TurnDiffFileEntry {
    return { path: 'a.ts', kind: 'modify', additions: 2, deletions: 1, ...overrides }
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

describe('fileQueryFor（单文件查询组装）', () => {
    it('普通条目：{scope, path}，指针不进协议', () => {
        expect(fileQueryFor('last-turn', entry({ path: 'x/y.ts' }))).toEqual({ scope: 'last-turn', path: 'x/y.ts' })
        expect(fileQueryFor('staged', entry())).toEqual({ scope: 'staged', path: 'a.ts' })
    })

    it('last-turn 带 turnIndex（总览 head 序号）原样带回；其他档不带', () => {
        expect(fileQueryFor('last-turn', entry(), 7)).toEqual({ scope: 'last-turn', path: 'a.ts', turnIndex: 7 })
        expect(fileQueryFor('uncommitted', entry(), 7)).toEqual({ scope: 'uncommitted', path: 'a.ts' })
    })

    it('oversize：null（hook disabled，不发拉取，落「文件过大」降级 UI）', () => {
        expect(fileQueryFor('last-turn', entry({ oversize: true }), 7)).toBeNull()
    })
})
