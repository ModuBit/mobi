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
 * v2（审查重写票05）：patch（diff 方法）+ contents（全文对，懒拉通道）两路查询，
 * 组装成旧 DiffViewer 的 before/after/patch 视图形状（DiffViewer 本体换血在票 07）。
 */

import { Button, Flex, Spin } from 'antd'
import { useTranslation } from 'react-i18next'
import type { DiffTarget, ReviewFileEntry } from '@mobi/shared'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import { basename } from '@/core/utils/path'
import { DiffViewer } from './DiffViewer'
import type { GitReviewDeps } from './reviewDeps'

export function RowDiff({ sessionId, target, entry, version, deps, wrap = true }: {
    sessionId: string
    /** 审查目标（五档统一寻址） */
    target: DiffTarget
    entry: ReviewFileEntry
    /** 总览的 targetGeneration（数据版本），总览刷新即展开行 diff 缓存失效 */
    version: number | string
    deps: GitReviewDeps
    /** 自动换行开关（审查面板工具区切换） */
    wrap?: boolean
}) {
    const { t } = useTranslation()
    const openFileTab = useWorkspaceStore((s) => s.openFileTab)

    // oversized 由 CLI 单点打标：不发 diff 拉取（null path → hook disabled），直接降级
    const patch = deps.useReviewPatch(sessionId, target, entry.oversized ? null : entry.path, version)
    const contents = deps.useReviewContents(sessionId, target, entry.oversized ? null : entry.path, true)

    if (entry.oversized) {
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
    const error = patch.error ?? contents.error
    if (error) {
        return <Flex align="center" justify="center" style={{ flex: 1, fontSize: 12, color: 'var(--ant-color-error)' }}>{error}</Flex>
    }
    if (patch.isLoading || contents.isLoading || (!patch.data && !contents.data)) {
        return <Flex align="center" justify="center" style={{ flex: 1, padding: 24 }}><Spin size="small" /></Flex>
    }
    return (
        <DiffBody
            patch={patch.data?.patch ?? ''}
            before={contents.data?.before ?? null}
            after={contents.data?.after ?? null}
            wrap={wrap}
        />
    )
}

function DiffBody({ patch, before, after, wrap }: { patch: string; before: string | null; after: string | null; wrap: boolean }) {
    const { t } = useTranslation()
    // before/after 全文是渲染主通道；二进制或两侧皆缺（如删除且无全文）降级 patch 文本
    if (before === null && after === null) {
        return (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: 12 }}>
                {patch ? (
                    <pre style={{ margin: 0, fontSize: 12, fontFamily: 'var(--font-mono, monospace)', whiteSpace: 'pre-wrap', color: 'var(--ant-color-text)' }}>{patch}</pre>
                ) : (
                    <span style={{ fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>{t('review.noDiff')}</span>
                )}
            </div>
        )
    }
    return <DiffViewer before={before ?? ''} after={after ?? ''} wrap={wrap} />
}
