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
 * 呈现分支按「oversize 降级 → 错误 → 加载 → DiffViewer/patch 兜底」顺序收口。
 */

import { Button, Flex, Spin } from 'antd'
import { useTranslation } from 'react-i18next'
import type { GitReviewFileDiff, GitReviewScope, TurnDiffFileEntry } from '@mobi/shared'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import { basename } from '@/core/utils/path'
import { DiffViewer } from './DiffViewer'
import type { GitReviewDeps } from './reviewDeps'
import { fileQueryFor } from './reviewEntries'

export function RowDiff({ sessionId, scope, entry, version, deps }: {
    sessionId: string
    scope: GitReviewScope
    entry: TurnDiffFileEntry
    /** 总览拉取时间，总览刷新即展开行 diff 缓存失效 */
    version: number
    deps: GitReviewDeps
}) {
    const { t } = useTranslation()
    const openFileTab = useWorkspaceStore((s) => s.openFileTab)

    // oversize 由 CLI 单点打标：不发 diff 拉取（null query → hook disabled），直接降级
    const diff = deps.useFileDiff(sessionId, fileQueryFor(scope, entry), version)

    if (entry.oversize) {
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
    if (diff.error) {
        return <Flex align="center" justify="center" style={{ flex: 1, fontSize: 12, color: 'var(--ant-color-error)' }}>{diff.error}</Flex>
    }
    if (diff.isLoading || !diff.data) {
        return <Flex align="center" justify="center" style={{ flex: 1, padding: 24 }}><Spin size="small" /></Flex>
    }
    return <DiffBody fileDiff={diff.data} />
}

function DiffBody({ fileDiff }: { fileDiff: GitReviewFileDiff }) {
    const { t } = useTranslation()
    // before/after 全文是渲染主通道；二进制或两侧皆缺（如删除且无全文）降级 patch 文本
    if (fileDiff.before === null && fileDiff.after === null) {
        return (
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: 12 }}>
                {fileDiff.patch ? (
                    <pre style={{ margin: 0, fontSize: 12, fontFamily: 'var(--font-mono, monospace)', whiteSpace: 'pre-wrap', color: 'var(--ant-color-text)' }}>{fileDiff.patch}</pre>
                ) : (
                    <span style={{ fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>{t('review.noDiff')}</span>
                )}
            </div>
        )
    }
    return <DiffViewer before={fileDiff.before ?? ''} after={fileDiff.after ?? ''} />
}
