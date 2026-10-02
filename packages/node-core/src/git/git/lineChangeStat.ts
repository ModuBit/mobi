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
 * 行变更统计（审查 v3 票02 抽出）：journal 供数档的行数计算单源。
 * turn 卡合成（turnDiffReporter）与审查 turn 档（gitReview handler）共用，勿复制。
 *
 * 算法：行多重集差（与 CC structuredPatch 的行计数语义近似，零上下文场景精确、
 * 重复行场景保守）——gitReview.journalToEntries 自 v2 起即此算法，抽出后语义不变。
 */

/** before/after 全文对 → 行多重集差计数（两侧都 null = 0/0） */
export function countLineChanges(before: string | null, after: string | null): { additions: number; deletions: number } {
    const multiset = (lines: string[]): Map<string, number> => {
        const m = new Map<string, number>()
        for (const line of lines) m.set(line, (m.get(line) ?? 0) + 1)
        return m
    }
    const split = (content: string): string[] => {
        const lines = content.split('\n')
        if (lines.at(-1) === '') lines.pop()
        return lines
    }
    const b = multiset(before === null ? [] : split(before))
    const a = multiset(after === null ? [] : split(after))
    let additions = 0
    let deletions = 0
    for (const [line, count] of a) additions += Math.max(count - (b.get(line) ?? 0), 0)
    for (const [line, count] of b) deletions += Math.max(count - (a.get(line) ?? 0), 0)
    return { additions, deletions }
}
