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
 * 审查视图的数据依赖注入点：测试换假数据源（不碰网络），生产走 react-query /
 * useSession 实现。GitReviewView 与 RowDiff 共用此接口——hook 的调用方（行内 diff
 * 懒加载）与视图主体注入同一套假源，测试才能单点替换。
 *
 * v2（审查重写票05）：DiffTarget 统一模型的五 hooks 面——overview（逐档可用性 +
 * 数据版本）/ files / patch / contents（懒拉 enabled）/ commits（翻页累积）。
 */

import { useReviewCommits, useReviewContents, useReviewFiles, useReviewInit, useReviewOverview, useReviewPatch, type ReviewCommitsQueryResult, type ReviewContentsQueryResult, type ReviewFilesQueryResult, type ReviewInitResult, type ReviewOverviewResult, type ReviewPatchQueryResult } from '@/core/data/hooks/queries/useGitReview'
import { useSession } from '@/core/data/hooks/queries/useSession'
import type { DiffTarget } from '@mobi/shared'

export interface GitReviewDeps {
    useReviewOverview: (sessionId: string) => ReviewOverviewResult
    useReviewFiles: (sessionId: string, target: DiffTarget | null, version: number | string) => ReviewFilesQueryResult
    useReviewPatch: (sessionId: string, target: DiffTarget | null, path: string | null, version: number | string) => ReviewPatchQueryResult
    useReviewContents: (sessionId: string, target: DiffTarget | null, path: string | null, enabled: boolean) => ReviewContentsQueryResult
    useReviewCommits: (sessionId: string) => ReviewCommitsQueryResult
    /** 一键 init git 仓库（票06；mutation 型，测试注入假源） */
    useReviewInit: (sessionId: string) => ReviewInitResult
    /** 会话是否 running（E2E/测试注入；生产走 useSession） */
    useSessionRunning: (sessionId: string) => boolean | undefined
}

export const defaultDeps: GitReviewDeps = {
    useReviewOverview,
    useReviewFiles,
    useReviewPatch,
    useReviewContents,
    useReviewCommits,
    useReviewInit,
    useSessionRunning: (sessionId) => useSession(sessionId).data?.running,
}
