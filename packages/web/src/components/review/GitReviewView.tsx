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
 * 审查视图（inspector「审查」tab，turn-diff 票05/06）：左文件清单 + 右 diff，
 * 四档范围切换（上一轮/未提交/未暂存/已暂存；shared GIT_REVIEW_SCOPES 单源）。
 * 档位受控——inspector 侧挂 tab viewState 持久化（票06），组件自身保持可测
 * （数据经 deps 注入的 hooks 拉取，测试注入假数据不碰网络）。
 */

import { memo, useEffect, useMemo, useState } from 'react'
import { Button, Segmented } from 'antd'
import { useTranslation } from 'react-i18next'
import { FileDiff, FileQuestion } from 'lucide-react'
import { GIT_REVIEW_SCOPES, type GitReviewData, type GitReviewFileDiff, type GitReviewFileQuery, type GitReviewScope, type GitReviewScopeData, type TurnDiffFileEntry } from '@mobi/shared'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import { basename } from '@/core/utils/path'
import { DiffViewer } from './DiffViewer'
import { useGitReviewData, useGitReviewFileDiff, type ReviewDataResult, type ReviewFileDiffResult } from '@/core/data/hooks/queries/useGitReview'

/** 大 diff 阈值（行数）：超过降级为「文件过大」+ 跳转文件查看器（票07，约 5k 行） */
const BIG_DIFF_LINES = 5000

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

/** 档位 → i18n key（shared GIT_REVIEW_SCOPES 单源遍历，新档位漏文案会在 UI 直接露 key） */
const SCOPE_LABEL_KEYS: Record<GitReviewScope, string> = {
    'last-turn': 'review.scope.lastTurn',
    uncommitted: 'review.scope.uncommitted',
    unstaged: 'review.scope.unstaged',
    staged: 'review.scope.staged',
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
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: 'var(--font-mono, monospace)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}>
                <span style={{ color: 'var(--ant-color-text-tertiary)' }}>{dir}</span>
                <span style={{ color: 'var(--ant-color-text)' }}>{base || file.path}</span>
                {/* 重命名成对呈现：旧名弱化跟在新名后（票07） */}
                {file.previousPath && (
                    <span style={{ color: 'var(--ant-color-text-tertiary)', marginLeft: 4 }}>← {basename(file.previousPath)}</span>
                )}
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

/** 左栏：统计 + 范围切换 + 目录分组文件清单 */
function FileList({ scope, scopes, onScopeChange, selectedPath, onSelect }: {
    scope: GitReviewScope
    scopes: GitReviewData['scopes']
    onScopeChange: (s: GitReviewScope) => void
    selectedPath: string | null
    onSelect: (path: string) => void
}) {
    const { t } = useTranslation()
    const scopeData = scopes[scope] as GitReviewScopeData | null
    const groups = useMemo(() => groupByDirectory(scopeData?.files ?? []), [scopeData])
    // 「上一轮」无快照链（会话无轮次变更消息）→ 禁用该档（空态文案诚实，不装死数据）
    const lastTurnMissing = scopes['last-turn'] === null

    return (
        <div style={{ width: 'min(264px, 42%)', flexShrink: 0, borderRight: '1px solid var(--ant-color-border-secondary)', overflowY: 'auto', minHeight: 0 }}>
            <div style={{ padding: '10px 8px 4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: 'var(--ant-color-text)' }}>
                    <FileDiff size={14} aria-hidden />
                    {t('review.title')}
                </div>
                <Segmented
                    size="small"
                    block
                    value={scope}
                    onChange={(v) => onScopeChange(v as GitReviewScope)}
                    options={GIT_REVIEW_SCOPES.map((s) => ({
                        value: s,
                        label: t(SCOPE_LABEL_KEYS[s]),
                        disabled: s === 'last-turn' && lastTurnMissing,
                    }))}
                    style={{ marginTop: 6 }}
                    data-testid="review-scope-switch"
                />
            </div>
            {scopeData && (
                <div style={{ padding: '0 8px', fontSize: 12, fontFamily: 'var(--font-mono, monospace)' }}>
                    <span style={{ color: 'var(--ant-color-text-secondary)' }}>{t('review.fileCount', { count: scopeData.stats.files })}</span>{' '}
                    <span style={{ color: '#4E9A51' }}>+{scopeData.stats.additions}</span>{' '}
                    <span style={{ color: '#C2544D' }}>-{scopeData.stats.deletions}</span>
                    {scopeData.truncated && (
                        <span style={{ marginLeft: 6, fontFamily: 'inherit', color: 'var(--ant-color-text-tertiary)' }} title={t('review.truncated')}>…</span>
                    )}
                </div>
            )}
            <div style={{ padding: '4px 4px 8px' }}>
                {groups.map(({ dir, files }) => (
                    <div key={dir}>
                        <DirLabel dir={dir} />
                        {files.map((file) => (
                            <FileRow key={`${file.kind}:${file.path}`} file={file} selected={file.path === selectedPath} onSelect={() => onSelect(file.path)} />
                        ))}
                    </div>
                ))}
                {scopeData && scopeData.files.length === 0 && (
                    <div style={{ padding: '12px 8px', fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>
                        {scope === 'last-turn' ? t('review.noSnapshotChanges') : t('review.empty')}
                    </div>
                )}
                {!scopeData && (
                    <div style={{ padding: '12px 8px', fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>{t('review.noSnapshot')}</div>
                )}
            </div>
        </div>
    )
}

/** 右栏 diff：吃 RPC 三件套（before/after 全文渲染；patch 仅降级）。查询按档位组装 */
function DiffPane({ sessionId, scope, scopeData, selectedPath, deps }: {
    sessionId: string
    scope: GitReviewScope
    scopeData: GitReviewScopeData
    selectedPath: string | null
    deps: GitReviewDeps
}) {
    const { t } = useTranslation()
    const openFileTab = useWorkspaceStore((s) => s.openFileTab)
    const entry = scopeData.files.find((f) => f.path === selectedPath) ?? null

    // last-turn 档带两树指针（无服务器状态；rename 条目带旧路径供基线侧取 before）；
    // 其他档按 scope 现查；指针缺失（非 git）不发起
    const query: GitReviewFileQuery | null = !entry
        ? null
        : scope === 'last-turn'
            ? (scopeData.git
                ? { scope, path: entry.path, ...(entry.previousPath && { previousPath: entry.previousPath }), baseTree: scopeData.git.baseTree, headTree: scopeData.git.headTree }
                : null)
            : { scope, path: entry.path }
    const diff = deps.useFileDiff(sessionId, query)

    if (!entry) {
        return <div style={{ flex: 1, display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>{t('review.selectFile')}</div>
    }
    // 大 diff 降级（票07）：渲染引擎吃全文，超大文件卡真机——跳转文件查看器
    if (!entry.binary && entry.additions + entry.deletions > BIG_DIFF_LINES) {
        return (
            <div data-testid="review-too-big" style={{ flex: 1, display: 'grid', placeItems: 'center', gap: 10, alignContent: 'center', fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>
                {t('review.tooBig')}
                <Button
                    size="small"
                    data-testid="review-too-big-open"
                    onClick={() => openFileTab(sessionId, entry.path, basename(entry.path))}
                >
                    {t('review.openInViewer')}
                </Button>
            </div>
        )
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

export const GitReviewView = memo(function GitReviewView({ sessionId, scope: scopeProp, onScopeChange, deps = defaultDeps }: {
    sessionId: string
    /** 受控档位（inspector 经 tab viewState 持久化）；缺省「上一轮」 */
    scope?: GitReviewScope
    onScopeChange?: (s: GitReviewScope) => void
    deps?: GitReviewDeps
}) {
    const { t } = useTranslation()
    const [scopeState, setScopeState] = useState<GitReviewScope>('last-turn')
    const scope = scopeProp ?? scopeState
    const changeScope = onScopeChange ?? setScopeState

    const review = deps.useReviewData(sessionId)
    const [selectedPath, setSelectedPath] = useState<string | null>(null)

    const scopeData = review.data?.scopes[scope] ?? null
    // 数据到位后默认选中首个文件；切档位重置选择（各档文件集不同，跨档残留无意义）
    useEffect(() => {
        setSelectedPath(null)
    }, [scope])
    useEffect(() => {
        if (scopeData && selectedPath === null && !review.isLoading) {
            setSelectedPath(scopeData.files[0]?.path ?? null)
        }
    }, [scopeData, selectedPath, review.isLoading])

    if (review.isLoading) {
        return <div data-testid="git-review-view" style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>{t('review.loading')}</div>
    }
    if (review.error) {
        return <div data-testid="git-review-view" style={{ display: 'grid', placeItems: 'center', height: '100%', gap: 8, fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>
            <FileQuestion size={28} aria-hidden />
            {review.error}
        </div>
    }
    if (!review.data || review.data.unavailable) {
        return <div data-testid="git-review-view" style={{ display: 'grid', placeItems: 'center', height: '100%', gap: 8, padding: 24, fontSize: 12, color: 'var(--ant-color-text-tertiary)', textAlign: 'center' }}>
            <FileQuestion size={28} aria-hidden />
            {t('review.unavailable')}
        </div>
    }
    // 「上一轮」无快照链：档位已禁用，这里兜底诚实空态（直开 tab 等边界路径）
    if (!scopeData) {
        return <div data-testid="git-review-view" style={{ display: 'flex', height: '100%', minHeight: 0 }}>
            <FileList scope={scope} scopes={review.data.scopes} onScopeChange={changeScope} selectedPath={null} onSelect={setSelectedPath} />
            <div style={{ flex: 1, display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>{t('review.noSnapshot')}</div>
        </div>
    }

    return (
        <div data-testid="git-review-view" style={{ display: 'flex', height: '100%', minHeight: 0 }}>
            <FileList scope={scope} scopes={review.data.scopes} onScopeChange={changeScope} selectedPath={selectedPath} onSelect={setSelectedPath} />
            <DiffPane sessionId={sessionId} scope={scope} scopeData={scopeData} selectedPath={selectedPath} deps={deps} />
        </div>
    )
})
