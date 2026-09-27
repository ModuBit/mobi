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
 * 审查视图（inspector「审查」tab，turn-diff 票05）：左文件清单 + 右 diff。
 * 本票交付「上一轮」档完整体验（scope 切换与四档补全在票06）；数据经 deps 注入
 * 的 hooks 拉取——组件可测（测试注入假数据，不碰网络）。
 */

import { memo, useEffect, useMemo, useState } from 'react'
import { theme } from 'antd'
import { useTranslation } from 'react-i18next'
import { FileDiff, FileQuestion } from 'lucide-react'
import type { GitReviewFileDiff, GitReviewFileQuery, GitReviewScopeData, TurnDiffFileEntry } from '@mobi/shared'
import { basename } from '@/core/utils/path'
import { DiffViewer } from './DiffViewer'
import { useGitReviewData, useGitReviewFileDiff, type ReviewDataResult, type ReviewFileDiffResult } from '@/core/data/hooks/queries/useGitReview'

/** 依赖注入点：测试换假数据源，生产走 react-query 实现 */
export interface GitReviewDeps {
    useReviewData: (sessionId: string) => ReviewDataResult
    useFileDiff: (sessionId: string, query: GitReviewFileQuery | null) => ReviewFileDiffResult
}

const defaultDeps: GitReviewDeps = {
    useReviewData: useGitReviewData,
    useFileDiff: useGitReviewFileDiff,
}

/** kind 徽标（同 TurnDiffCard 配色纪律：固定色不随主题） */
const KIND_BADGES: Record<TurnDiffFileEntry['kind'], { label: string; color: string } | null> = {
    add: { label: 'A', color: '#4E9A51' },
    delete: { label: 'D', color: '#C2544D' },
    rename: { label: 'R', color: '#8A6FC9' },
    modify: null,
}

/** 按目录分组（同目录聚一块，根目录文件排最前；保持输入的 path 排序稳定） */
function groupByDirectory(files: readonly TurnDiffFileEntry[]): { dir: string; files: TurnDiffFileEntry[] }[] {
    const groups = new Map<string, TurnDiffFileEntry[]>()
    for (const file of files) {
        const idx = file.path.lastIndexOf('/')
        const dir = idx === -1 ? '' : file.path.slice(0, idx)
        const list = groups.get(dir)
        if (list) list.push(file)
        else groups.set(dir, [file])
    }
    return [...groups.entries()]
        .map(([dir, grouped]) => ({ dir, files: grouped }))
        .sort((a, b) => a.dir.localeCompare(b.dir))
}

function DirLabel({ dir }: { dir: string }) {
    const { t } = useTranslation()
    return <div style={{ fontSize: 11, color: 'var(--ant-color-text-tertiary)', padding: '6px 8px 2px' }}>{dir || t('review.rootDir')}</div>
}

function FileRow({ file, selected, onSelect }: { file: TurnDiffFileEntry; selected: boolean; onSelect: () => void }) {
    const base = basename(file.path)
    const idx = file.path.lastIndexOf('/')
    const dir = idx === -1 ? '' : file.path.slice(0, idx + 1)
    const badge = KIND_BADGES[file.kind]
    return (
        <div
            role="button"
            data-testid="review-file-row"
            onClick={onSelect}
            style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 6,
                cursor: 'pointer', background: selected ? 'var(--ant-color-fill-tertiary)' : 'transparent',
            }}
        >
            {badge && (
                <span style={{ fontSize: 10, fontFamily: 'var(--font-mono, monospace)', color: '#fff', background: badge.color, borderRadius: 4, padding: '0 4px', lineHeight: '15px' }}>
                    {badge.label}
                </span>
            )}
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: 'var(--font-mono, monospace)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={file.path}>
                <span style={{ color: 'var(--ant-color-text-tertiary)' }}>{dir}</span>
                <span style={{ color: 'var(--ant-color-text)' }}>{base || file.path}</span>
            </span>
            {!file.binary && (
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono, monospace)', whiteSpace: 'nowrap' }}>
                    <span style={{ color: '#4E9A51' }}>+{file.additions}</span>{' '}
                    <span style={{ color: '#C2544D' }}>-{file.deletions}</span>
                </span>
            )}
        </div>
    )
}

/** 左栏：scope 标题 + 统计 + 目录分组文件清单 */
function FileList({ scopeData, selectedPath, onSelect }: { scopeData: GitReviewScopeData; selectedPath: string | null; onSelect: (path: string) => void }) {
    const { t } = useTranslation()
    const groups = useMemo(() => groupByDirectory(scopeData.files), [scopeData.files])

    return (
        <div style={{ width: 264, flexShrink: 0, borderRight: '1px solid var(--ant-color-border-secondary)', overflowY: 'auto', minHeight: 0 }}>
            <div style={{ padding: '10px 8px 4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: 'var(--ant-color-text)' }}>
                    <FileDiff size={14} aria-hidden />
                    {t('review.scope.lastTurn')}
                </div>
                <div style={{ marginTop: 2, fontSize: 12, fontFamily: 'var(--font-mono, monospace)' }}>
                    <span style={{ color: 'var(--ant-color-text-secondary)' }}>{t('review.fileCount', { count: scopeData.stats.files })}</span>{' '}
                    <span style={{ color: '#4E9A51' }}>+{scopeData.stats.additions}</span>{' '}
                    <span style={{ color: '#C2544D' }}>-{scopeData.stats.deletions}</span>
                </div>
            </div>
            <div style={{ padding: '0 4px 8px' }}>
                {groups.map(({ dir, files }) => (
                    <div key={dir}>
                        <DirLabel dir={dir} />
                        {files.map((file) => (
                            <FileRow key={`${file.kind}:${file.path}`} file={file} selected={file.path === selectedPath} onSelect={() => onSelect(file.path)} />
                        ))}
                    </div>
                ))}
                {scopeData.files.length === 0 && (
                    <div style={{ padding: '12px 8px', fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>{t('review.empty')}</div>
                )}
            </div>
        </div>
    )
}

/** 右栏 diff：吃 RPC 三件套（before/after 全文渲染；patch 仅降级） */
function DiffPane({ sessionId, scopeData, selectedPath, deps }: { sessionId: string; scopeData: GitReviewScopeData; selectedPath: string | null; deps: GitReviewDeps }) {
    const { t } = useTranslation()
    const entry = scopeData.files.find((f) => f.path === selectedPath) ?? null

    // last-turn 档带两树指针（无服务器状态）；缺失（非 git / 档位空）则不发起查询
    const query: GitReviewFileQuery | null =
        entry && scopeData.git
            ? { scope: 'last-turn', path: entry.path, baseTree: scopeData.git.baseTree, headTree: scopeData.git.headTree }
            : null
    const diff = deps.useFileDiff(sessionId, query)

    if (!entry) {
        return <div style={{ flex: 1, display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>{t('review.selectFile')}</div>
    }
    if (diff.error) {
        return <div style={{ flex: 1, display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--ant-color-error)' }}>{diff.error}</div>
    }
    if (diff.isLoading || !diff.data) {
        return <div style={{ flex: 1, display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>{t('review.loading')}</div>
    }
    if (entry.binary) {
        return <div style={{ flex: 1, display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>{t('chat.turnDiff.binary')}</div>
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

export const GitReviewView = memo(function GitReviewView({ sessionId, deps = defaultDeps }: { sessionId: string; deps?: GitReviewDeps }) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const review = deps.useReviewData(sessionId)
    const [selectedPath, setSelectedPath] = useState<string | null>(null)

    // 数据到位后默认选中第一个文件（无人工选择时）
    const scopeData = review.data?.scopes['last-turn'] ?? null
    useEffect(() => {
        if (scopeData && selectedPath === null) {
            setSelectedPath(scopeData.files[0]?.path ?? null)
        }
    }, [scopeData, selectedPath])

    if (review.isLoading) {
        return <div style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: 12, color: token.colorTextTertiary }}>{t('review.loading')}</div>
    }
    if (review.error) {
        return <div style={{ display: 'grid', placeItems: 'center', height: '100%', gap: 8, fontSize: 12, color: token.colorTextTertiary }}>
            <FileQuestion size={28} aria-hidden />
            {review.error}
        </div>
    }
    if (!review.data || review.data.unavailable || !scopeData) {
        return <div style={{ display: 'grid', placeItems: 'center', height: '100%', gap: 8, padding: 24, fontSize: 12, color: token.colorTextTertiary, textAlign: 'center' }}>
            <FileQuestion size={28} aria-hidden />
            {t('review.unavailable')}
        </div>
    }

    return (
        <div data-testid="git-review-view" style={{ display: 'flex', height: '100%', minHeight: 0 }}>
            <FileList scopeData={scopeData} selectedPath={selectedPath} onSelect={setSelectedPath} />
            <DiffPane sessionId={sessionId} scopeData={scopeData} selectedPath={selectedPath} deps={deps} />
        </div>
    )
})
