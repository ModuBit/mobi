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
 * 内容对 → review 条目判定单源（审查 v3 结构收口）：kind / 行数计数 / oversized
 * 三项判定的唯一出口。消费方：turn 档供数器的 journal / 封口归档条目（原
 * journalToEntries / archiveToReviewEntries）与 turnDiffReporter 的合成条目（原
 * entryKind / entryCounts）——四处近似实现收于此处，勿复制。
 *
 * kind 规则：before null 且 after 有 = add / after null 且 before 有 = delete /
 * 其余 modify。计数：行多重集差（countLineChanges，与 journal 源既有口径一致）。
 * oversized：additions + deletions > OVERSIZE_DIFF_LINES（与 git 条目同判据；原
 * journal 源的行数判据是其近似，随单源退役）。untracked 恒 true（内容层源的采集
 * 事实，git 条目走 toReviewEntry）；binary 恒 false（全文对为文本）。
 */

import { OVERSIZE_DIFF_LINES, ReviewFileEntrySchema, type ReviewFileEntry } from '@mobi/shared'
import { countLineChanges } from './lineChangeStat'

/** 内容对 → review 条目（kind/counts/oversized 判定单源） */
export function reviewEntryFromContents(path: string, before: string | null, after: string | null): ReviewFileEntry {
    const kind = before === null && after !== null
        ? 'add' as const
        : after === null && before !== null
            ? 'delete' as const
            : 'modify' as const
    const counts = countLineChanges(before, after)
    return ReviewFileEntrySchema.parse({
        path,
        previousPath: null,
        kind,
        additions: counts.additions,
        deletions: counts.deletions,
        binary: false,
        untracked: true,
        oversized: counts.additions + counts.deletions > OVERSIZE_DIFF_LINES,
    })
}
