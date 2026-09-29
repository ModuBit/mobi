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
import { useTranslation } from 'react-i18next'
import type { DiffTarget, ReviewFileEntry } from '@mobi/shared'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import { basename } from '@/core/utils/path'
import { DiffViewer } from './DiffViewer'
import type { GitReviewDeps } from './reviewDeps'

export function RowDiff({ sessionId, target, entry, version, deps, wrap = true, layout = 'unified' }: {
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
}) {
    const { t } = useTranslation()
    const openFileTab = useWorkspaceStore((s) => s.openFileTab)

    // oversized 由 CLI 单点打标：不发 diff 拉取（null path → hook disabled），直接降级
    const patch = deps.useReviewPatch(sessionId, target, entry.oversized ? null : entry.path, version)

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
    if (patch.error) {
        return <Flex align="center" justify="center" style={{ flex: 1, fontSize: 12, color: 'var(--ant-color-error)' }}>{patch.error}</Flex>
    }
    if (patch.isLoading || !patch.data) {
        return <Flex align="center" justify="center" style={{ flex: 1, padding: 24 }}><Spin size="small" /></Flex>
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
