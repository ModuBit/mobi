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
 * 审查文件条目的可展开性 / 单文件查询语义（纯函数，jsdom 单测覆盖边界）。
 * GitReviewView 的行箭头、Collapse 过滤、树面板联动、RowDiff 查询组装共用同一口径——
 * 「哪些条目可看 diff、查询怎么发」集中一处而非散落成内联条件。
 */

import type { GitReviewFileQuery, GitReviewScope, TurnDiffFileEntry } from '@mobi/shared'

/**
 * 可 diff 判定：只有文本类条目才可展开（不可展开的行点击无效果、无箭头）。binary 是
 * CLI 单点标记（tracked numstat 与 untracked no-index 两条组装管线同口径），行数判断
 * 只用于展开性，oversize 行仍可展开——展开落「文件过大」降级 UI（不发 diff 查询）
 */
export function isDiffable(entry: TurnDiffFileEntry): boolean {
    return !entry.binary && (entry.additions + entry.deletions > 0 || !!entry.previousPath)
}

/**
 * 行内展开的 diff 查询组装：统一 {scope, path}（last-turn 两树由 CLI 从快照链解析，
 * 指针不进协议）；oversize 条目返回 null（hook disabled，不发拉取，直接落降级 UI）
 */
export function fileQueryFor(scope: GitReviewScope, entry: TurnDiffFileEntry): GitReviewFileQuery | null {
    return entry.oversize ? null : { scope, path: entry.path }
}
