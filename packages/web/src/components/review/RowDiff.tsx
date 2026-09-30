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
 * 行内展开的 diff 区（Collapse children）：挂载即拉取、卸载即停——懒加载由此承载。
 * v2（审查重写票07）：patch 查询闸 loading/error/oversized，渲染本体交
 * DiffViewer（@pierre/diffs，patch 主输入 + contents hydration 懒拉）。
 */

import { Button, Flex, Spin } from 'antd'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { DiffTarget, ReviewFileEntry } from '@mobi/shared'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import { basename } from '@/core/utils/path'
import { DiffViewer } from './DiffViewer'
import type { GitReviewDeps } from './reviewDeps'

export function RowDiff({ sessionId, target, entry, version, deps, wrap = true, layout = 'unified', onPendingChange }: {
    sessionId: string
    /** 审查目标（五档统一寻址） */
    target: DiffTarget
    entry: ReviewFileEntry
    /** 总览的 targetGeneration（数据版本），总览刷新即展开行 diff 缓存失效 */
    version: number | string
    deps: GitReviewDeps
    /** 自动换行开关（审查面板工具区切换） */
    wrap?: boolean
    /** diff 布局（unified/split，票06） */
    layout?: 'unified' | 'split'
    /** 查询 pending 状态上报（行头 loading 指示用）；卸载必回 false */
    onPendingChange?: (path: string, pending: boolean) => void
}) {
    const { t } = useTranslation()
    const openFileTab = useWorkspaceStore((s) => s.openFileTab)

    // hydration 后 oversized 照常拉取：读侧对带 ref 的归档条目现场合成 patch（API 出口
    // 截断），无 ref（旧归档）返回 oversized 打标 + 空 patch → 降级 tooBig
    const patch = deps.useReviewPatch(sessionId, target, entry.path, version)

    // pending 上报：与下方 Spin 的判据同口径（无数据也算 pending）；卸载收尾
    useEffect(() => {
        onPendingChange?.(entry.path, patch.isLoading || !patch.data)
        return () => onPendingChange?.(entry.path, false)
    }, [entry.path, patch.isLoading, patch.data, onPendingChange])

    // 纯 rename（内容零增删）的 patch 只有 rename 头、无 hunk——pierre 在
    // disableFileHeader 下渲染 0 高空白（E2E 实测），诚实给专用文案
    const renameOnly = entry.kind === 'rename' && (entry.additions ?? 0) + (entry.deletions ?? 0) === 0

    if (renameOnly) {
        return (
            <Flex data-testid="review-rename-only" align="center" justify="center" style={{ flex: 1, fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>
                {t('review.renameOnly')}
            </Flex>
        )
    }
    if (patch.error) {
        return <Flex align="center" justify="center" style={{ flex: 1, fontSize: 12, color: 'var(--ant-color-error)' }}>{patch.error}</Flex>
    }
    if (patch.isLoading || !patch.data) {
        return <Flex align="center" justify="center" style={{ flex: 1, padding: 24 }}><Spin size="small" /></Flex>
    }
    if (patch.data.oversized && !patch.data.patch) {
        // 归档条目 oversized 且无 patch 可给（旧归档无 ref）：降级 tooBig + 跳文件查看器。
        // 有 patch（含 API 出口截断形态）照常进 DiffViewer，截断标注由其 footer 承载
        return (
            <Flex data-testid="review-too-big" vertical align="center" justify="center" gap={10} style={{ flex: 1, fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>
                {t('review.tooBig')}
                <Button
                    size="small"
                    data-testid="review-too-big-open"
                    onClick={() => openFileTab(sessionId, entry.path, basename(entry.path))}
                >
                    {t('review.openInViewer')}
                </Button>
            </Flex>
        )
    }
    return (
        <DiffViewer
            sessionId={sessionId}
            target={target}
            path={entry.path}
            version={version}
            wrap={wrap}
            layout={layout}
        />
    )
}
