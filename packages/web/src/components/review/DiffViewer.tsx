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
 * 单文件 diff 渲染（审查重写票07）：渲染本体换 @pierre/diffs 的 PatchDiff——
 * patch 主输入（虚拟化承载大 diff），loadDiffFiles hydration 懒拉全文展开上下文。
 * 姿势全部来自 PoC 票01 实证（.scratch/review-render-rewrite/poc-report.md）：
 * - host 高度 + 外层滚动容器由调用方给（diffs-container 原生组件不自持高度）
 * - 空 patch 直接 throw——本组件守卫降级为 noDiff 文案
 * - hydration reject 库内静默降级纯 patch，不白屏
 * - 主题走 PIERRE_BRIDGE_VARS（antd token 桥，单声明双档）
 */

import { useMemo } from 'react'
import { PatchDiff } from '@pierre/diffs/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { type DiffTarget } from '@mobi/shared'
import { useMobiApi } from '@/core/data/api/client'
import { makeReviewContentsQueryFn, makeReviewPatchQueryFn } from '@/core/data/hooks/queries/useGitReview'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'
import { queryKeys } from '@/core/lib/query-keys'
import { PIERRE_BRIDGE_VARS } from './pierreTheme'

export function DiffViewer({ sessionId, target, path, version, wrap, layout }: {
    sessionId: string
    /** 审查目标（五档统一寻址） */
    target: DiffTarget
    path: string
    /** 总览的 targetGeneration（数据版本）：总览刷新 → patch 缓存键换代自动重查 */
    version: number | string
    /** 自动换行开关（审查面板工具区切换） */
    wrap: boolean
    /** 布局（unified/split，票06 工具区切换） */
    layout: 'unified' | 'split'
}) {
    const { t } = useTranslation()
    const api = useMobiApi()
    const queryClient = useQueryClient()
    const resolved = useUiStore((s) => resolveTheme(s.theme))

    // patch 与行内 RowDiff 同键共享缓存（RowDiff 先行闸 loading/error，这里只管渲染输入）。
    // queryFn 必须与 useReviewPatch 同形（makeReviewPatchQueryFn）——同键异形会让缓存命中
    // 后读到对方的包装形状，静默落空分支
    const patch = useQuery({
        queryKey: queryKeys.gitReviewPatch(sessionId, target, path, version),
        queryFn: makeReviewPatchQueryFn(api, sessionId, target, path),
        enabled: !!sessionId && !!target && !!path,
    })
    const patchPayload = patch.data

    // hydration 懒拉：pierre 首次展开折叠上下文才 fetchQuery（与 useReviewContents 同键
    // 共享缓存）。queryFn 必须同形（makeReviewContentsQueryFn）——同键异形会让缓存命中
    // 后读到对方的包装形状，静默落空分支。键携带 version（与 patch 同代）：staleTime
    // 窗口内 fetchQuery 命中的必须是新代全文，否则 hydration 上下文与 patch 行号错位
    const loadDiffFiles = useMemo(() => async () => {
        const payload = await queryClient.fetchQuery({
            queryKey: queryKeys.gitReviewContents(sessionId, target, path, version),
            queryFn: makeReviewContentsQueryFn(api, sessionId, target, path),
        })
        if (!payload || payload.data === undefined) throw new Error(payload?.error ?? 'contents unavailable')
        const data = payload.data
        // FileContents 形状 {name, contents}：库的 hydration 返回类型只有两种合法形状
        // （双全文 / 纯改名 oldFile:null）——删除文件（after=null）落纯改名形，hunk 内容
        // 不受影响（patch 已含删行）；两侧皆缺直接抛错走库内静默降级
        if (data.before === null && data.after === null) throw new Error('contents unavailable')
        return data.before === null
            ? { oldFile: null, newFile: { name: path, contents: data.after ?? '' } }
            : { oldFile: { name: path, contents: data.before }, newFile: { name: path, contents: data.after ?? '' } }
    }, [api, queryClient, sessionId, target, path, version])

    // turn 档不配 loadDiffFiles（turn-archive B：归档只存统计+patch，全文零进盘，
    // 无全文可 hydrate——零 RPC；其余档懒拉展开折叠上下文）
    const options = useMemo(() => ({
        diffStyle: layout,
        overflow: (wrap ? 'wrap' : 'scroll') as 'wrap' | 'scroll',
        hunkSeparators: 'line-info' as const,
        disableFileHeader: true,
        themeType: resolved as 'light' | 'dark',
        ...(target.kind !== 'turn' && { loadDiffFiles }),
    }), [layout, wrap, resolved, target, loadDiffFiles])

    return (
        <div
            data-testid="git-diff-viewer"
            aria-label={t('review.diffAria')}
            style={{ flex: 1, minWidth: 0, height: '100%', minHeight: 0, display: 'flex', overflow: 'auto' }}
        >
            {/* 空 patch 直接 throw（PoC 实证）——二进制/空 diff 诚实降级文案 */}
            {patchPayload && patchPayload.data && patchPayload.data.patch ? (
                <PatchDiff patch={patchPayload.data.patch} options={options} style={{ ...PIERRE_BRIDGE_VARS, height: '100%', flex: 1 }} />
            ) : (
                <span style={{ margin: 'auto', fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>{t('review.noDiff')}</span>
            )}
        </div>
    )
}
