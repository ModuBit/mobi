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
 * 轮次变更（Turn Diff，ADR 0008 + 审查 v3 供数反转）：一轮对话造成的文件变更事实，
 * CLI 在轮次结束时合成的 custom 消息载荷（自定义事件形态，见 userContentSchema 的
 * custom-event）。
 *
 * 事实源与口径（v3 双轨）：归因主源 = turn 内工具层内容对累积（本会话 Edit 族，封口
 * 归档供历史轮回看）；实况兜底 = 相邻两快照 diff 的 numstat（累积为空才回落）；
 * 非 git 目录 `git: null`，文件清单与计数来自工具事件投影的近似口径。文件清单与增删
 * 统计只有一个权威口径（聊天卡与审查视图共用），数字不许有两套。
 */

import { z } from 'zod'

/** 自定义事件名：渲染注册表与 CLI 合成端共用的路由键（防漂移单源） */
export const TURN_DIFF_EVENT = 'turn-diff'

export const TurnDiffFileKindSchema = z.enum(['add', 'delete', 'rename', 'modify'])
export type TurnDiffFileKind = z.infer<typeof TurnDiffFileKindSchema>

export const TurnDiffFileEntrySchema = z.object({
    /** 变更后路径（rename = 新路径；delete = 被删路径）；仓库相对或绝对，透传不解析 */
    path: z.string().min(1),
    kind: TurnDiffFileKindSchema,
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    /** rename 的原路径 */
    previousPath: z.string().min(1).optional(),
    /** 二进制文件：计数无意义，恒 0，以本标记表达 */
    binary: z.boolean().optional(),
})

/** 内联 diff 渲染阈值（行数）：超过即 oversized 降级。CLI 打标、web 消费的唯一判据 */
export const OVERSIZE_DIFF_LINES = 5000

/**
 * 审查 patch 渲染安全线（行数）：diff 方法出口的单文件 patch 截断闸——pierre 渲染核
 * 无虚拟化（E2E 实测 6000 行 = 24k DOM 节点、展开秒级卡顿），超过即截断（API 不全量
 * 返回），web 渲染截断 patch + 「Open in Viewer」出口。独立于 OVERSIZE_DIFF_LINES
 * （那是封口存储/传输维度的闸），渲染维度阈更低。contents 全文行闸同值。
 */
export const REVIEW_RENDER_MAX_LINES = 1500
export type TurnDiffFileEntry = z.infer<typeof TurnDiffFileEntrySchema>

/** 变更统计三件套（文件数/增/删）：聊天卡总统计与审查档位统计同形同口径 */
export const TurnDiffStatsSchema = z.object({
    files: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
})
export type TurnDiffStats = z.infer<typeof TurnDiffStatsSchema>

export const TurnDiffPayloadSchema = z.object({
    /** 归属轮次序号：git 模式 = 快照链序；非 git 模式 = 会话内合成计数 */
    turnIndex: z.number().int().positive(),
    /** diff 基线轮次（null = 会话首个有快照的 turn，无更早快照可作基线——不存在 HEAD 兜底语义） */
    baseTurnIndex: z.number().int().positive().nullable(),
    stats: TurnDiffStatsSchema,
    files: z.array(TurnDiffFileEntrySchema),
    /** 快照对：git 模式的权威事实源指针（审查视图据此复核）；null = 非 git 目录（近似口径） */
    git: z.object({
        baseTree: z.string().min(1),
        headTree: z.string().min(1),
    }).nullable(),
})
export type TurnDiffPayload = z.infer<typeof TurnDiffPayloadSchema>

/** 由 entries 汇总 stats（合成端与测试共用，避免两处数数） */
export function summarizeTurnDiffFiles(files: readonly TurnDiffFileEntry[]): TurnDiffStats {
    return {
        files: files.length,
        additions: files.reduce((sum, f) => sum + f.additions, 0),
        deletions: files.reduce((sum, f) => sum + f.deletions, 0),
    }
}

// ─── 审查数据链（git RPC，ADR 0006 machine 通道）───────────────────────────────

/** machine 通道 git RPC 方法名（CLI handler 注册与 hub RpcGateway 转发共用，防漂移单源） */
export const GIT_REVIEW_RPC = {
    /** 会话删除时的快照引用清理（hub best-effort 调用） */
    clear: 'clearTurnSnapshots',
    // 审查重写 v2 六方法（spec .scratch/review-render-rewrite）：DiffTarget 统一模型
    overview: 'gitReviewOverview',
    files: 'gitReviewFiles',
    diff: 'gitReviewDiff',
    contents: 'gitReviewContents',
    commits: 'gitReviewCommits',
    init: 'gitReviewInit',
} as const

// ─── 审查重写 v2 协议（DiffTarget 统一模型，六方法）──────────────────────────
//
// 数据链：patch 主通道 + 全文对懒拉（pierre loadDiffFiles hydration）。
// 陈旧性：overview 返回 targetGeneration（刷新版本号），web 缓存键携带它防
// 「总览展示与点击之间有新轮完成」的错位（替代旧 turnIndex 特判的通用化）。

/** 审查目标（五档收敛的统一寻址）：turn = 快照链两树；worktree = 三工作区档；
 *  commit = 任意提交对（本轮协议预留，first-parent 语义由 CLI resolver 决定） */
export const DiffTargetSchema = z.discriminatedUnion('kind', [
    /** 上一轮：缺省 turnIndex = 链尾（最新完成的轮） */
    z.object({ kind: z.literal('turn'), turnIndex: z.number().int().positive().optional() }),
    z.object({ kind: z.literal('worktree'), area: z.enum(['uncommitted', 'unstaged', 'staged']) }),
    z.object({
        kind: z.literal('commit'),
        range: z.object({ base: z.string().min(1), head: z.string().min(1) }),
    }),
])
export type DiffTarget = z.infer<typeof DiffTargetSchema>

/** 五档可用性矩阵（逐档，替代旧全局 unavailable）：true = 该档当前不可用。
 *  非 git 目录：turn 由工具层降级源供数（false），git 系全 true */
export const ReviewUnavailableScopesSchema = z.object({
    turn: z.boolean(),
    uncommitted: z.boolean(),
    unstaged: z.boolean(),
    staged: z.boolean(),
    commit: z.boolean(),
})
export type ReviewUnavailableScopes = z.infer<typeof ReviewUnavailableScopesSchema>

/** 单档统计三件套（轻量，总览态只用得到计数——文件明细走 files 方法） */
export const ReviewScopeSummarySchema = z.object({
    fileCount: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
})
export type ReviewScopeSummary = z.infer<typeof ReviewScopeSummarySchema>

/** 审查总览：四档 + commit 可用性一次拉（与会话 metadata 解析出的 cwd 绑定，hub 只透传） */
export const ReviewOverviewSchema = z.object({
    unavailableScopes: ReviewUnavailableScopesSchema,
    isGitRepository: z.boolean(),
    /** 各档统计（不可用档 null；非 git 目录 turn 非 null——工具层降级源供数） */
    scopes: z.object({
        turn: ReviewScopeSummarySchema.nullable(),
        uncommitted: ReviewScopeSummarySchema.nullable(),
        unstaged: ReviewScopeSummarySchema.nullable(),
        staged: ReviewScopeSummarySchema.nullable(),
    }),
    /** 总览统计超过内联上限时打标（明细仍可拉，UI 降级提示） */
    truncated: z.boolean(),
    /** 总览刷新版本：任何影响档位数据的会话事件自增；web 缓存键携带防陈旧 */
    targetGeneration: z.number().int().nonnegative(),
})
export type ReviewOverview = z.infer<typeof ReviewOverviewSchema>

/** 文件明细条目（五档统一形状；untracked/oversized 等事实由 CLI 打标） */
export const ReviewFileEntrySchema = z.object({
    path: z.string().min(1),
    /** rename 的原路径 */
    previousPath: z.string().min(1).nullable(),
    kind: TurnDiffFileKindSchema,
    /** 工具层降级源可能给不出计数 */
    additions: z.number().int().nullable(),
    deletions: z.number().int().nullable(),
    binary: z.boolean(),
    /** git 未跟踪（--no-index 口径的 diff 事实） */
    untracked: z.boolean(),
    /** diff 超过内联预算：UI 降级为「文件过大」，不发起 diff 拉取 */
    oversized: z.boolean(),
})
export type ReviewFileEntry = z.infer<typeof ReviewFileEntrySchema>

/** 文件明细（files 方法响应）：targetGeneration 随行，web 原样并入后续 diff/contents 查询的缓存键 */
export const ReviewFilesResultSchema = z.object({
    files: z.array(ReviewFileEntrySchema),
    stats: TurnDiffStatsSchema,
    truncated: z.boolean(),
    targetGeneration: z.number().int().nonnegative(),
})
export type ReviewFilesResult = z.infer<typeof ReviewFilesResultSchema>

/** 单文件 patch（diff 方法响应）：pierre PatchDiff 主输入。
 *  truncatedLines = patch 总行数（仅截断时 >0；完整 = 0，default 兼容旧 CLI wire），
 *  patch 字段此时只含前 REVIEW_RENDER_MAX_LINES 行 */
export const ReviewPatchResultSchema = z.object({
    patch: z.string(),
    previousPath: z.string().min(1).nullable(),
    oversized: z.boolean(),
    binary: z.boolean(),
    truncatedLines: z.number().int().nonnegative().default(0),
})
export type ReviewPatchResult = z.infer<typeof ReviewPatchResultSchema>

/** 全文对（contents 方法响应）：pierre hydration 懒拉。
 *  reason 三态 = 拿不到全文的诚实降级原因（null = 成功返回两侧全文） */
export const ReviewContentsResultSchema = z.object({
    before: z.string().nullable(),
    after: z.string().nullable(),
    reason: z.enum(['oversized', 'binary', 'missing']).nullable(),
})
export type ReviewContentsResult = z.infer<typeof ReviewContentsResultSchema>

/** 历史提交（commits 方法条目）：parentSha 供前端组 range {base: parentSha, head: sha} */
export const ReviewCommitSchema = z.object({
    sha: z.string().min(1),
    /** 根提交无父：null（web 对根提交禁选或以空树为 base） */
    parentSha: z.string().min(1).nullable(),
    subject: z.string(),
    authorName: z.string(),
    authorTimestamp: z.number().int(),
})
export type ReviewCommit = z.infer<typeof ReviewCommitSchema>

/** 提交列表（commits 方法响应）：nextCursor = 最后一条 sha，null = 到底 */
export const ReviewCommitsResultSchema = z.object({
    commits: z.array(ReviewCommitSchema),
    /** 游标 = 偏移量字符串（实现取最简单者），null = 到底 */
    nextCursor: z.string().min(1).nullable(),
})
export type ReviewCommitsResult = z.infer<typeof ReviewCommitsResultSchema>

/** 动作结果（init 方法响应） */
export const ReviewActionResultSchema = z.object({
    success: z.boolean(),
    error: z.string().nullable(),
})
export type ReviewActionResult = z.infer<typeof ReviewActionResultSchema>
