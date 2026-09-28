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
 * 轮次变更（Turn Diff，ADR 0008）：一轮对话造成的文件变更事实，CLI 在轮次结束时
 * 合成的 custom 消息载荷（自定义事件形态，见 userContentSchema 的 custom-event）。
 *
 * 事实源与口径：git 模式下统计 = 相邻两快照 diff 的 numstat（唯一权威口径，聊天卡
 * 与审查视图共用，数字不许有两套）；非 git 目录 `git: null`，文件清单与计数来自
 * 工具事件投影的近似口径（Bash 写文件覆盖不到，是该降级档的已知边界）。
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
export type TurnDiffFileEntry = z.infer<typeof TurnDiffFileEntrySchema>

export const TurnDiffPayloadSchema = z.object({
    /** 归属轮次序号：git 模式 = 快照链序；非 git 模式 = 会话内合成计数 */
    turnIndex: z.number().int().positive(),
    /** diff 基线轮次（null = 会话首个有快照的 turn，基线为 HEAD 树） */
    baseTurnIndex: z.number().int().positive().nullable(),
    stats: z.object({
        files: z.number().int().nonnegative(),
        additions: z.number().int().nonnegative(),
        deletions: z.number().int().nonnegative(),
    }),
    files: z.array(TurnDiffFileEntrySchema),
    /** 快照对：git 模式的权威事实源指针（审查视图据此复核）；null = 非 git 目录（近似口径） */
    git: z.object({
        baseTree: z.string().min(1),
        headTree: z.string().min(1),
    }).nullable(),
})
export type TurnDiffPayload = z.infer<typeof TurnDiffPayloadSchema>

/** 由 entries 汇总 stats（合成端与测试共用，避免两处数数） */
export function summarizeTurnDiffFiles(files: readonly TurnDiffFileEntry[]): TurnDiffPayload['stats'] {
    return {
        files: files.length,
        additions: files.reduce((sum, f) => sum + f.additions, 0),
        deletions: files.reduce((sum, f) => sum + f.deletions, 0),
    }
}

// ─── 审查数据链（git RPC，ADR 0006 machine 通道）───────────────────────────────

/** 审查范围档位（受控注册，CONTEXT.md「审查范围」）：未注册的档位在结构上不存在 */
export const GIT_REVIEW_SCOPES = ['last-turn', 'uncommitted', 'unstaged', 'staged'] as const
export type GitReviewScope = (typeof GIT_REVIEW_SCOPES)[number]

/** 单档位数据：文件条目 + 汇总 + 事实指针（last-turn 的两树；其他档 null） */
export const GitReviewScopeDataSchema = z.object({
    files: z.array(TurnDiffFileEntrySchema),
    stats: z.object({
        files: z.number().int().nonnegative(),
        additions: z.number().int().nonnegative(),
        deletions: z.number().int().nonnegative(),
    }),
    /** last-turn 档的两树指针（UI 点文件据此回查 diff）；其他档为 null */
    git: z.object({ baseTree: z.string().min(1), headTree: z.string().min(1) }).nullable(),
    /** untracked 截断事实（超上限不再逐个数行，条目仍列出但计数可能缺失） */
    truncated: z.boolean().optional(),
})
export type GitReviewScopeData = z.infer<typeof GitReviewScopeDataSchema>

/** 审查总览：四档一次拉（与会话 metadata 解析出的 cwd 绑定，hub 只透传） */
export const GitReviewDataSchema = z.object({
    /** 非 git 目录总开关：true 时四档全 null（UI 诚实空态） */
    unavailable: z.boolean(),
    scopes: z.object({
        'last-turn': GitReviewScopeDataSchema.nullable(),
        uncommitted: GitReviewScopeDataSchema,
        unstaged: GitReviewScopeDataSchema,
        staged: GitReviewScopeDataSchema,
    }),
})
export type GitReviewData = z.infer<typeof GitReviewDataSchema>

/** 单文件 diff 查询：四档统一 {scope, path}——last-turn 的两树解析由 CLI 侧从快照链
 *  完成（链在它手里，浏览器不传树指针）；rename 旧路径同样由 CLI 从 diff 条目自解析。
 *  陈旧性由 web 缓存键携带审查总览的刷新版本（协议外元数据，不进请求体） */
export const GitReviewFileQuerySchema = z.object({
    scope: z.enum(['last-turn', 'uncommitted', 'unstaged', 'staged']),
    path: z.string().min(1),
})
export type GitReviewFileQuery = z.infer<typeof GitReviewFileQuerySchema>

/** 单文件 diff 三件套（patch 给统计与降级、before/after 全文给渲染，ZCode GitDiffResult 同款） */
export const GitReviewFileDiffSchema = z.object({
    patch: z.string(),
    before: z.string().nullable(),
    after: z.string().nullable(),
})
export type GitReviewFileDiff = z.infer<typeof GitReviewFileDiffSchema>

/** machine 通道 git RPC 方法名（CLI handler 注册与 hub RpcGateway 转发共用，防漂移单源） */
export const GIT_REVIEW_RPC = {
    data: 'gitReviewData',
    file: 'gitReviewFile',
} as const
