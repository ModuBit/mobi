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
 * worktree 生命周期协议（worktree-lifecycle spec）：daemon 扫描列表、合回主树、
 * 丢弃、会话删除保留事实的 Zod 单源。Web 与 daemon 共用同一份形状，避免两端
 * 各写一套字段口径。
 */

import { z } from 'zod'

/**
 * 列表态：clean/dirty/unknown 是脏判定三态（unknown = git 失败，按 dirty 保守对待）；
 * running 是运行中会话的 worktree（不可合回/丢弃，优先级高于脏判定结果）。
 */
export const WORKTREE_STATES = ['clean', 'dirty', 'unknown', 'running'] as const
export const WorktreeStateSchema = z.enum(WORKTREE_STATES)
export type WorktreeState = z.infer<typeof WorktreeStateSchema>

/** 单个 mobi worktree 的完整画像（列表项） */
export const WorktreeSummarySchema = z.object({
    name: z.string(),
    branch: z.string(),
    worktreePath: z.string(),
    repoRoot: z.string(),
    /** 主仓库当前检出分支（合回目标；detached/读取失败时缺省） */
    repoBranch: z.string().optional(),
    /** 反查到的所属会话；孤儿 worktree 缺省 */
    sessionId: z.string().optional(),
    state: WorktreeStateSchema,
    /** 排除 .mobi 状态路径后的改动文件数 */
    dirtyFileCount: z.number().int().nonnegative(),
    /** 脏文件大小和（近似占用，非磁盘真实占用） */
    sizeBytes: z.number().int().nonnegative(),
    /** worktree 目录创建时间（epoch ms） */
    createdAt: z.number().optional(),
    /** 分支 HEAD 的提交时间（epoch ms） */
    lastCommitAt: z.number().optional()
})
export type WorktreeSummary = z.infer<typeof WorktreeSummarySchema>

export const WorktreeListResponseSchema = z.object({
    worktrees: z.array(WorktreeSummarySchema)
})
export type WorktreeListResponse = z.infer<typeof WorktreeListResponseSchema>

/** 合并策略：no-ff 保留完整历史；squash 压成一条提交 */
export const WORKTREE_MERGE_STRATEGIES = ['no-ff', 'squash'] as const
export const WorktreeMergeStrategySchema = z.enum(WORKTREE_MERGE_STRATEGIES)
export type WorktreeMergeStrategy = z.infer<typeof WorktreeMergeStrategySchema>

export const MergeBackRequestSchema = z.object({
    worktreePath: z.string().min(1),
    strategy: WorktreeMergeStrategySchema.optional().default('no-ff'),
    /** 成功后是否移除 worktree 并删除分支（默认 true） */
    cleanup: z.boolean().optional().default(true)
})
/**
 * 线上请求形状（z.input）：strategy / cleanup 均带默认值，客户端可省略，
 * 由 daemon 解析时补默认——前端不应被迫重复声明默认值。
 */
export type MergeBackRequest = z.input<typeof MergeBackRequestSchema>

/** 合回失败原因（前端按码映射 i18n，message 仅作诊断细节） */
export const MERGE_BACK_FAILURE_REASONS = [
    'invalid-worktree',
    'session-running',
    'main-dirty',
    'repo-mismatch',
    'detached-head',
    'merge-failed',
    'git-failed'
] as const
export const MergeBackFailureReasonSchema = z.enum(MERGE_BACK_FAILURE_REASONS)
export type MergeBackFailureReason = z.infer<typeof MergeBackFailureReasonSchema>

export const MergeBackResultSchema = z.union([
    z.object({
        ok: z.literal(true),
        strategy: WorktreeMergeStrategySchema,
        worktreeRemoved: z.boolean(),
        branchDeleted: z.boolean(),
        /** 清理未完全成功等非致命事实（如分支删除被 git 拒绝） */
        warning: z.string().optional()
    }),
    z.object({
        ok: z.literal(false),
        reason: MergeBackFailureReasonSchema,
        /** 冲突时附冲突文件清单；主树脏时附脏文件清单 */
        files: z.array(z.string()).optional(),
        /** true = merge 冲突（主树已回滚，WIP 提交保留在 worktree 分支） */
        conflict: z.boolean().optional(),
        message: z.string().optional()
    })
])
export type MergeBackResult = z.infer<typeof MergeBackResultSchema>

export const DiscardRequestSchema = z.object({
    worktreePath: z.string().min(1)
})
export type DiscardRequest = z.infer<typeof DiscardRequestSchema>

export const DISCARD_FAILURE_REASONS = ['invalid-worktree', 'session-running', 'git-failed'] as const
export const DiscardFailureReasonSchema = z.enum(DISCARD_FAILURE_REASONS)
export type DiscardFailureReason = z.infer<typeof DiscardFailureReasonSchema>

export const DiscardResultSchema = z.union([
    z.object({
        ok: z.literal(true),
        worktreeRemoved: z.boolean(),
        branchDeleted: z.boolean(),
        warning: z.string().optional()
    }),
    z.object({
        ok: z.literal(false),
        reason: DiscardFailureReasonSchema,
        message: z.string().optional()
    })
])
export type DiscardResult = z.infer<typeof DiscardResultSchema>

/** 删除会话时「worktree 已保留」事实（脏或 unknown 不静默销毁） */
export const RetainedWorktreeSchema = WorktreeSummarySchema.pick({
    name: true,
    branch: true,
    worktreePath: true,
    state: true,
    dirtyFileCount: true
})
export type RetainedWorktree = z.infer<typeof RetainedWorktreeSchema>

/** DELETE /api/sessions/:id 响应（保持既有 ok 形状，附加保留事实） */
export const DeleteSessionResponseSchema = z.object({
    ok: z.literal(true),
    retainedWorktree: RetainedWorktreeSchema.optional()
})
export type DeleteSessionResponse = z.infer<typeof DeleteSessionResponseSchema>
