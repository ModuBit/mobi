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
 * 轮次变更载荷 schema 契约 + custom-event 词汇的通道纪律（用户通道拒绝、custom 通道接纳）。
 * 三方一致性（shared 事件名 ↔ web 渲染注册 ↔ CLI 合成端）的 lock 在各包测试中引用本文件的
 * 常量与 schema——本文件只锁 wire 形状本身。
 */

import { describe, expect, it } from 'vitest'
import {
    MessageContentSchema,
    normalizeContentBlocks,
    normalizeUserContent,
} from '../src/userContentSchema'
import {
    DiffTargetSchema,
    ReviewFilesResultSchema,
    ReviewOverviewSchema,
    GIT_REVIEW_RPC,
    summarizeTurnDiffFiles,
    TURN_DIFF_EVENT,
    TurnDiffPayloadSchema,
} from '../src/turnDiff'
import type { TurnDiffPayload } from '../src/turnDiff'
import { UserMessageContentSchema } from '../src/userContentSchema'

const VALID_PAYLOAD: TurnDiffPayload = {
    turnIndex: 1,
    baseTurnIndex: null,
    stats: { files: 2, additions: 5, deletions: 3 },
    files: [
        { path: 'src/a.ts', kind: 'modify', additions: 4, deletions: 3 },
        { path: 'b.ts', kind: 'rename', additions: 1, deletions: 0, previousPath: 'c.ts', binary: false },
    ],
    git: { baseTree: 'a'.repeat(40), headTree: 'b'.repeat(40) },
}

describe('TurnDiffPayloadSchema', () => {
    it('合法载荷（git 口径与降级口径）通过校验', () => {
        expect(TurnDiffPayloadSchema.safeParse(VALID_PAYLOAD).success).toBe(true)
        expect(TurnDiffPayloadSchema.safeParse({ ...VALID_PAYLOAD, git: null }).success).toBe(true)
    })

    it('非法载荷被拒：负计数 / 未知 kind / 非正 turnIndex / 结构缺失', () => {
        expect(TurnDiffPayloadSchema.safeParse({ ...VALID_PAYLOAD, stats: { ...VALID_PAYLOAD.stats, additions: -1 } }).success).toBe(false)
        expect(TurnDiffPayloadSchema.safeParse({
            ...VALID_PAYLOAD,
            files: [{ path: 'x', kind: 'moved', additions: 0, deletions: 0 }],
        }).success).toBe(false)
        expect(TurnDiffPayloadSchema.safeParse({ ...VALID_PAYLOAD, turnIndex: 0 }).success).toBe(false)
        expect(TurnDiffPayloadSchema.safeParse({ ...VALID_PAYLOAD, git: { baseTree: '', headTree: 'x' } }).success).toBe(false)
    })

    it('summarizeTurnDiffFiles：files/additions/deletions 由 entries 单点汇总', () => {
        expect(summarizeTurnDiffFiles(VALID_PAYLOAD.files)).toEqual({ files: 2, additions: 5, deletions: 3 })
        expect(summarizeTurnDiffFiles([])).toEqual({ files: 0, additions: 0, deletions: 0 })
    })
})

describe('DiffTargetSchema（审查重写 v2）', () => {
    it('三种 kind 合法样例通过', () => {
        expect(DiffTargetSchema.safeParse({ kind: 'turn' }).success).toBe(true)
        expect(DiffTargetSchema.safeParse({ kind: 'turn', turnIndex: 3 }).success).toBe(true)
        expect(DiffTargetSchema.safeParse({ kind: 'worktree', area: 'uncommitted' }).success).toBe(true)
        expect(DiffTargetSchema.safeParse({ kind: 'commit', range: { base: 'a', head: 'b' } }).success).toBe(true)
    })

    it('非法目标被拒：未知 kind / 缺 range / 负 turnIndex / 未知 area', () => {
        expect(DiffTargetSchema.safeParse({ kind: 'branch' }).success).toBe(false)
        expect(DiffTargetSchema.safeParse({ kind: 'commit', range: { base: 'a' } }).success).toBe(false)
        expect(DiffTargetSchema.safeParse({ kind: 'turn', turnIndex: 0 }).success).toBe(false)
        expect(DiffTargetSchema.safeParse({ kind: 'worktree', area: 'index' }).success).toBe(false)
    })
})

describe('审查 v2 schema（overview / files）', () => {
    const VALID_OVERVIEW = {
        unavailableScopes: { turn: false, uncommitted: false, unstaged: false, staged: false, commit: false },
        isGitRepository: true,
        scopes: {
            turn: { fileCount: 2, additions: 5, deletions: 3 },
            uncommitted: { fileCount: 0, additions: 0, deletions: 0 },
            unstaged: null,
            staged: null,
        },
        truncated: false,
        targetGeneration: 1,
    }

    it('overview 合法样例通过：git 档可用与非 git 档（turn 非 null 其余 null）', () => {
        expect(ReviewOverviewSchema.safeParse(VALID_OVERVIEW).success).toBe(true)
        expect(ReviewOverviewSchema.safeParse({
            ...VALID_OVERVIEW,
            isGitRepository: false,
            unavailableScopes: { turn: false, uncommitted: true, unstaged: true, staged: true, commit: true },
        }).success).toBe(true)
    })

    it('overview 非法被拒：scopes 可用性档缺失 / 负计数', () => {
        expect(ReviewOverviewSchema.safeParse({
            ...VALID_OVERVIEW,
            unavailableScopes: { turn: false, uncommitted: false, staged: false, commit: false },
        }).success).toBe(false)
        expect(ReviewOverviewSchema.safeParse({
            ...VALID_OVERVIEW,
            scopes: { ...VALID_OVERVIEW.scopes, turn: { fileCount: -1, additions: 0, deletions: 0 } },
        }).success).toBe(false)
    })

    it('files 结果：条目 nullable 字段与 targetGeneration 契约', () => {
        const result = {
            files: [
                { path: 'a.ts', previousPath: null, kind: 'modify', additions: 1, deletions: 0, binary: false, untracked: false, oversized: false },
                { path: 'b.png', previousPath: null, kind: 'add', additions: null, deletions: null, binary: true, untracked: true, oversized: false },
            ],
            stats: { files: 2, additions: 1, deletions: 0 },
            truncated: false,
            targetGeneration: 7,
        }
        expect(ReviewFilesResultSchema.safeParse(result).success).toBe(true)
        expect(ReviewFilesResultSchema.safeParse({ ...result, targetGeneration: '7' }).success).toBe(false)
    })

    it('六方法名注册在 GIT_REVIEW_RPC（防漂移单源 lock）', () => {
        expect(GIT_REVIEW_RPC.overview).toBe('gitReviewOverview')
        expect(GIT_REVIEW_RPC.files).toBe('gitReviewFiles')
        expect(GIT_REVIEW_RPC.diff).toBe('gitReviewDiff')
        expect(GIT_REVIEW_RPC.contents).toBe('gitReviewContents')
        expect(GIT_REVIEW_RPC.commits).toBe('gitReviewCommits')
        expect(GIT_REVIEW_RPC.init).toBe('gitReviewInit')
    })
})

describe('custom-event 词汇的通道纪律（ADR 0002 延伸）', () => {
    const block = { type: 'custom-event', name: TURN_DIFF_EVENT, value: VALID_PAYLOAD }

    it('custom 通道（MessageContentSchema / normalizeContentBlocks）接纳 custom-event', () => {
        expect(MessageContentSchema.safeParse([block]).success).toBe(true)
        expect(normalizeContentBlocks([block])).toEqual([block])
    })

    it('用户通道拒绝 custom-event：schema 拒绝，归一过滤兜底', () => {
        expect(UserMessageContentSchema.safeParse([block]).success).toBe(false)
        // 读取侧归一过滤（防历史脏数据）：custom-event 被剔除，纯 custom-event 归一为 null
        expect(normalizeUserContent([{ type: 'text', text: 'hi' }, block])).toEqual([{ type: 'text', text: 'hi' }])
        expect(normalizeUserContent([block])).toBeNull()
    })
})
