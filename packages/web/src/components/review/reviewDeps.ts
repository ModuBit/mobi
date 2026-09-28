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
 */

import { useGitReviewData, useGitReviewFileDiff, type ReviewDataResult, type ReviewFileDiffResult } from '@/core/data/hooks/queries/useGitReview'
import { useSession } from '@/core/data/hooks/queries/useSession'
import type { GitReviewFileQuery } from '@mobi/shared'

export interface GitReviewDeps {
    useReviewData: (sessionId: string) => ReviewDataResult
    useFileDiff: (sessionId: string, query: GitReviewFileQuery | null, version: number) => ReviewFileDiffResult
    /** 会话是否 running（E2E/测试注入；生产走 useSession） */
    useSessionRunning: (sessionId: string) => boolean | undefined
}

export const defaultDeps: GitReviewDeps = {
    useReviewData: useGitReviewData,
    useFileDiff: useGitReviewFileDiff,
    useSessionRunning: (sessionId) => useSession(sessionId).data?.running,
}
