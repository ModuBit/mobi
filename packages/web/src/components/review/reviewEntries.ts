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
 * 审查文件条目的可展开性 / 档位可用性语义（纯函数，jsdom 单测覆盖边界）。
 * GitReviewView 的行箭头、Collapse 过滤、树面板联动、档位禁用共用同一口径——
 * 「哪些条目可看 diff、哪些档位可用」集中一处而非散落成内联条件。
 *
 * v2（审查重写票05）：条目形状换 ReviewFileEntry（计数 nullable、oversized 打标），
 * 档位寻址换 DiffTarget（可用性矩阵在 overview.unavailableScopes）。
 */

import { DiffTargetSchema, type DiffTarget, type ReviewFileEntry, type ReviewOverview } from '@mobi/shared'

/**
 * 可 diff 判定：只有文本类条目才可展开（不可展开的行点击无效果、无箭头）。binary 是
 * CLI 单点标记；oversized 可展开——hydration 后读侧对带 ref 的归档条目现场合成 patch，
 * 无 ref（旧归档）由 RowDiff 按 patch 结果降级 tooBig；行数判断只用于展开性——工具层
 * 降级源可能给不出计数（null 按 0）
 */
export function isDiffable(entry: ReviewFileEntry): boolean {
    return !entry.binary && ((entry.additions ?? 0) + (entry.deletions ?? 0) > 0 || !!entry.previousPath)
}

/** 档位可用性（overview 的可用性矩阵 → 当前 target 一个布尔）；overview 未到不算不可用 */
export function isTargetUnavailable(overview: ReviewOverview | undefined, target: DiffTarget): boolean {
    if (!overview) return false
    if (target.kind === 'turn') return overview.unavailableScopes.turn
    if (target.kind === 'commit') return overview.unavailableScopes.commit
    return overview.unavailableScopes[target.area]
}

/** Select 序列化键 → DiffTarget（损坏输入抛错，调用方吞掉不切档） */
export function parseTargetKey(key: string): DiffTarget {
    return DiffTargetSchema.parse(JSON.parse(key))
}
