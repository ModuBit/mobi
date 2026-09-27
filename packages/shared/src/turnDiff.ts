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
