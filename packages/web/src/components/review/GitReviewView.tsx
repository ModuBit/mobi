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
 * 审查视图（inspector「审查」tab，turn-diff 票05/06/07）：顶部 header（范围切换 +
 * 汇总统计 + 右侧功能按钮），content 平铺文件列表（单击懒加载展开该文件 diff，
 * 多开不互斥），可开合右侧 diff 文件树面板（筛选 + 目录树，与文件
 * 目录树同款交互）。四档范围（上一轮/未提交/未暂存/已暂存；shared GIT_REVIEW_SCOPES
 * 单源）。档位受控——inspector 侧挂 tab viewState 持久化（票06），组件自身保持可测
 * （数据经 deps 注入的 hooks 拉取，测试注入假数据不碰网络）。
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Collapse, Empty, Flex, Input, Select, Spin, Tooltip, Tree } from 'antd'
import type { TreeProps } from 'antd'
import type { DataNode } from 'antd/es/tree'
import { useTranslation } from 'react-i18next'
import { CheckCheck, ChevronDown, Copy, ExternalLink, FileQuestion, FolderTree, Search } from 'lucide-react'
import { GIT_REVIEW_SCOPES, type GitReviewFileDiff, type GitReviewFileQuery, type GitReviewScope, type TurnDiffFileEntry } from '@mobi/shared'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'
import { useSession } from '@/core/data/hooks/queries/useSession'
import { basename } from '@/core/utils/path'
import { buildPathTree, collectDirKeys, type NestedFileNode } from '@/core/utils/pathTree'
import { copyTextToClipboard } from '@/components/chat/CopyButton'
import { DiffViewer } from './DiffViewer'
import { KIND_BADGES, FilePathLabel } from '@/components/chat/blocks/TurnDiffCard'
import { useGitReviewData, useGitReviewFileDiff, type ReviewDataResult, type ReviewFileDiffResult } from '@/core/data/hooks/queries/useGitReview'

/** 依赖注入点：测试换假数据源，生产走 react-query 实现 */
export interface GitReviewDeps {
    useReviewData: (sessionId: string) => ReviewDataResult
    useFileDiff: (sessionId: string, query: GitReviewFileQuery | null, version: number) => ReviewFileDiffResult
    /** 会话是否 running（E2E/测试注入；生产走 useSession） */
    useSessionRunning: (sessionId: string) => boolean | undefined
}

const defaultDeps: GitReviewDeps = {
    useReviewData: useGitReviewData,
    useFileDiff: useGitReviewFileDiff,
    useSessionRunning: (sessionId) => useSession(sessionId).data?.running,
}

/** 档位 → i18n key（shared GIT_REVIEW_SCOPES 单源遍历，新档位漏文案会在 UI 直接露 key） */
const SCOPE_LABEL_KEYS: Record<GitReviewScope, string> = {
    'last-turn': 'review.scope.lastTurn',
    uncommitted: 'review.scope.uncommitted',
    unstaged: 'review.scope.unstaged',
    staged: 'review.scope.staged',
}

/** 可 diff 判定：只有文本类条目才可展开（不可展开的行点击无效果、无箭头）。binary 是
 *  CLI 单点标记（tracked numstat 与 untracked no-index 两条组装管线同口径），行数判断
 *  只用于展开性，oversize 行仍可展开——展开落「文件过大」降级 UI（不发 diff 查询） */
function canDiff(entry: TurnDiffFileEntry): boolean {
    return !entry.binary && (entry.additions + entry.deletions > 0 || !!entry.previousPath)
}

/** 行内展开的 diff 区：组装查询并渲染（挂载即拉取，卸载即停——懒加载由此承载）。
 *  查询统一 {scope, path}——last-turn 两树由 CLI 从快照链解析，指针不进协议；
 *  version = 总览拉取时间，总览刷新即展开行 diff 缓存失效 */
function RowDiff({ sessionId, scope, entry, version, deps }: {
    sessionId: string
    scope: GitReviewScope
    entry: TurnDiffFileEntry
    version: number
    deps: GitReviewDeps
}) {
    const { t } = useTranslation()
    const openFileTab = useWorkspaceStore((s) => s.openFileTab)

    // oversize 由 CLI 单点打标：不发 diff 拉取（null query → hook disabled），直接降级
    const diff = deps.useFileDiff(sessionId, entry.oversize ? null : { scope, path: entry.path }, version)

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

/** 手风琴文件行的头（Collapse label）：徽标/路径 + 紧随其后的统计与展开箭头（均 hover 显现），
 *  行尾 hover 操作（复制/打开标签页）。Collapse 自带展开图标关闭（expandIcon=null） */
function FileRowHeader({ sessionId, file, expanded }: { sessionId: string; file: TurnDiffFileEntry; expanded: boolean }) {
    const { t } = useTranslation()
    const isDark = useUiStore((s) => resolveTheme(s.theme) === 'dark')
    const openFileTab = useWorkspaceStore((s) => s.openFileTab)
    const badge = KIND_BADGES[file.kind]

    /** 复制点击反馈：图标切绿勾 2s（与气泡 CopyButton 同款节奏）；卸载清定时器。
     *  反馈不等剪贴板结果——writeText 在无焦点文档里可能长时间挂起，别拖住 UI */
    const [copied, setCopied] = useState(false)
    const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => () => {
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }, [])
    const handleCopy = () => {
        void copyTextToClipboard(file.path)
        setCopied(true)
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
        copiedTimerRef.current = setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div
            role="button"
            className="review-file-row"
            data-testid="review-file-row"
            data-path={file.path}
            style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}
        >
            {badge && (
                <span
                    style={{
                        fontSize: 11, fontFamily: 'var(--font-mono, monospace)', fontWeight: 600,
                        color: isDark ? badge.dark : badge.light, flexShrink: 0,
                    }}
                >
                    {badge.label}
                </span>
            )}
            {/* 不许伸长（flex-grow 0）只可收缩省略：统计/箭头才能紧跟文件名，右侧空间归 spacer */}
            <span style={{ flex: '0 1 auto', minWidth: 0 }}>
                <FilePathLabel path={file.path} />
            </span>
            {/* 重命名成对呈现：旧名弱化跟在新名后（票07） */}
            {file.previousPath && (
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono, monospace)', color: 'var(--ant-color-text-tertiary)', flexShrink: 0 }} title={file.previousPath}>
                    ← {basename(file.previousPath)}
                </span>
            )}
            {!file.binary && (
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono, monospace)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    <span style={{ color: '#4E9A51' }}>+{file.additions}</span>{' '}
                    <span style={{ color: '#C2544D' }}>-{file.deletions}</span>
                </span>
            )}
            {/* 行操作：桌面 hover/focus 显现，触屏常显（antd.css 规则）。
                复制点击反馈与气泡 CopyButton 同款：图标切绿勾 2s 后还原 */}
            <Flex component="span" align="center" className="review-row-actions" style={{ flexShrink: 0 }}>
                <Tooltip title={copied ? t('chat.copied') : t('files.copyPath')}>
                    <Button
                        type="text" size="small"
                        aria-label={t('files.copyPath')}
                        icon={copied ? <CheckCheck size={13} color="var(--ant-color-success)" /> : <Copy size={13} />}
                        onClick={(e) => { e.stopPropagation(); handleCopy() }}
                    />
                </Tooltip>
                <Tooltip title={t('review.openInTab')}>
                    <Button
                        type="text" size="small"
                        aria-label={t('review.openInTab')}
                        icon={<ExternalLink size={13} />}
                        onClick={(e) => { e.stopPropagation(); openFileTab(sessionId, file.path, basename(file.path)) }}
                    />
                </Tooltip>
            </Flex>
            {/* 展开/收起箭头放行尾：hover 显现（Collapse 自带图标已关），随开合旋转。
                不可展开的条目（非文本）不给箭头——行本身不响应展开 */}
            {canDiff(file) && (
                <span className="review-row-chevron" style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', color: 'var(--ant-color-text-tertiary)' }}>
                    <ChevronDown
                        size={13}
                        style={{
                            transform: expanded ? 'none' : 'rotate(-90deg)',
                            transition: `transform var(--ant-motion-duration-mid, 0.2s) var(--ant-motion-ease-in-out, ease)`,
                        }}
                    />
                </span>
            )}
        </div>
    )
}

/** diff 文件树面板（右侧可开合）：筛选输入 + 目录树（复用文件目录树的 pathTree 工具），
 *  点文件叶节点 → 主列表展开该文件。树内文件挂 kind 徽标，与清单同语义 */
function DiffTreePanel({ files, selectedPath, onOpenFile }: {
    files: readonly TurnDiffFileEntry[]
    selectedPath: string | null
    onOpenFile: (path: string) => void
}) {
    const { t } = useTranslation()
    const isDark = useUiStore((s) => resolveTheme(s.theme) === 'dark')
    const [filter, setFilter] = useState('')
    const q = filter.trim().toLowerCase()
    const filtered = useMemo(
        () => (q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files),
        [files, q],
    )
    const entryByPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files])

    // 扁平条目 → 嵌套树（与文件目录树搜索同一条 buildPathTree 通路）
    const tree = useMemo(
        () => buildPathTree(filtered.map((f) => ({ name: basename(f.path), path: f.path, type: 'file' as const }))),
        [filtered],
    )

    /** 受控展开：数据（档位/筛选）变化即全展开——面板的树只承载变更文件，量小，全展开即默认形态 */
    const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([])
    useEffect(() => {
        setExpandedKeys(collectDirKeys(tree))
    }, [tree])

    const treeData: DataNode[] = useMemo(() => {
        const render = (nodes: NestedFileNode[]): DataNode[] =>
            nodes.map((n) => {
                if (n.type === 'directory') {
                    return { key: n.path, title: n.name, children: n.children ? render(n.children) : undefined }
                }
                const entry = entryByPath.get(n.path)
                const badge = entry ? KIND_BADGES[entry.kind] : null
                return {
                    key: n.path,
                    title: (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            {badge && (
                                <span style={{ fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-mono, monospace)', color: isDark ? badge.dark : badge.light }}>
                                    {badge.label}
                                </span>
                            )}
                            <span>{n.name}</span>
                        </span>
                    ),
                    isLeaf: true,
                }
            })
        return render(tree)
    }, [tree, entryByPath, isDark])

    const onSelect: TreeProps['onSelect'] = (_keys, info) => {
        if (info.node.isLeaf !== false) onOpenFile(String(info.node.key))
    }

    return (
        <Flex
            data-testid="review-tree-panel"
            vertical
            style={{ width: 264, flexShrink: 0, borderLeft: '1px solid var(--ant-color-border-secondary)', minHeight: 0 }}
        >
            <Input
                size="small"
                allowClear
                prefix={<Search size={13} />}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t('review.filterPlaceholder')}
                style={{ margin: 8 }}
                data-testid="review-tree-filter"
            />
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 4px 8px' }}>
                {filtered.length > 0 ? (
                    <Tree
                        blockNode
                        treeData={treeData}
                        expandedKeys={expandedKeys}
                        onExpand={(keys) => setExpandedKeys(keys)}
                        selectedKeys={selectedPath ? [selectedPath] : []}
                        onSelect={onSelect}
                    />
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('files.noResults')} style={{ marginTop: 24 }} />
                )}
            </div>
        </Flex>
    )
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
    const running = deps.useSessionRunning(sessionId)
    /** 多开：当前展开 diff 的文件路径集合（默认全收起，交给用户点开） */
    const [expandedPaths, setExpandedPaths] = useState<string[]>([])
    const [treeOpen, setTreeOpen] = useState(false)

    // 审查数据是易变工作区事实：tab 常挂不卸载，靠「running→idle 翻转」驱动 refetch——
    // 开着审查 tab 跑新轮次，turn 结束后上一轮档自动刷新（E2E 实证缺失此刷新的坑）
    const wasRunningRef = useRef(false)
    useEffect(() => {
        const isRunning = running ?? false
        if (wasRunningRef.current && !isRunning) review.refetch()
        wasRunningRef.current = isRunning
    }, [running, review])

    const scopeData = review.data?.scopes[scope] ?? null
    const files = scopeData?.files ?? []
    // 切档位清空展开（各档文件集不同，跨档残留无意义）
    useEffect(() => {
        setExpandedPaths([])
    }, [scope])

    // 「上一轮」无快照链（会话无轮次变更消息）→ 禁用该档（空态文案诚实，不装死数据）
    const lastTurnMissing = review.data?.scopes['last-turn'] === null

    if (review.isLoading) {
        return (
            <Flex data-testid="git-review-view" align="center" justify="center" gap={8} style={{ height: '100%', fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>
                <Spin size="small" />
                {t('review.loading')}
            </Flex>
        )
    }
    if (review.error) {
        return (
            <Flex data-testid="git-review-view" align="center" justify="center" style={{ height: '100%' }}>
                <Empty image={<FileQuestion size={36} color="var(--ant-color-text-quaternary)" />} description={<span style={{ fontSize: 12 }}>{review.error}</span>} />
            </Flex>
        )
    }
    if (!review.data || review.data.unavailable) {
        return (
            <Flex data-testid="git-review-view" align="center" justify="center" style={{ height: '100%', padding: 24 }}>
                <Empty image={<FileQuestion size={36} color="var(--ant-color-text-quaternary)" />} description={<span style={{ fontSize: 12 }}>{t('review.unavailable')}</span>} />
            </Flex>
        )
    }

    return (
        <Flex data-testid="git-review-view" vertical style={{ height: '100%', minHeight: 0 }}>
            {/* Header：范围切换 + 汇总统计 + 功能按钮 */}
            <Flex
                align="center"
                gap={10}
                style={{ padding: '8px 12px', borderBottom: '1px solid var(--ant-color-border-secondary)', flexShrink: 0 }}
            >
                <Select
                    size="small"
                    value={scope}
                    onChange={(v) => changeScope(v as GitReviewScope)}
                    style={{ width: 112 }}
                    popupMatchSelectWidth={false}
                    options={GIT_REVIEW_SCOPES.map((s) => ({
                        value: s,
                        label: t(SCOPE_LABEL_KEYS[s]),
                        disabled: s === 'last-turn' && lastTurnMissing,
                    }))}
                    data-testid="review-scope-switch"
                />
                {scopeData && (
                    <span style={{ fontSize: 12, fontFamily: 'var(--font-mono, monospace)', whiteSpace: 'nowrap' }}>
                        <span style={{ color: 'var(--ant-color-text-secondary)' }}>{t('review.fileCount', { count: scopeData.stats.files })}</span>{' '}
                        <span style={{ color: '#4E9A51' }}>+{scopeData.stats.additions}</span>{' '}
                        <span style={{ color: '#C2544D' }}>-{scopeData.stats.deletions}</span>
                        {scopeData.truncated && (
                            <Tooltip title={t('review.truncated')}>
                                <span style={{ marginLeft: 6, color: 'var(--ant-color-text-tertiary)', cursor: 'help' }}>…</span>
                            </Tooltip>
                        )}
                    </span>
                )}
                <Flex flex={1} />
                <Tooltip title={t('review.fileTree')}>
                    <Button
                        type="text" size="small"
                        aria-label={t('review.fileTree')}
                        data-testid="review-tree-toggle"
                        icon={<FolderTree size={15} style={{ color: treeOpen ? 'var(--ant-color-text)' : 'var(--ant-color-text-tertiary)' }} />}
                        onClick={() => setTreeOpen((v) => !v)}
                    />
                </Tooltip>
            </Flex>

            {/* Content：平铺文件清单（Collapse 手风琴）+ 可开合 diff 文件树 */}
            <Flex flex={1} style={{ minHeight: 0 }}>
                <Flex vertical flex={1} style={{ minWidth: 0, overflowY: 'auto' }}>
                    <Collapse
                        className="review-collapse"
                        ghost
                        size="small"
                        // 多开受控：activeKey 即展开集合，点按切换各自开合。
                        // 自带展开图标关闭——箭头画在行尾（hover 显现，随开合旋转）
                        expandIcon={() => null}
                        activeKey={expandedPaths}
                        onChange={(keys) => setExpandedPaths(keys.map(String).filter((k) => {
                            // 非文本类条目不可展开：把点按产生的 key 滤掉（web 端拦截，CLI 有兜底闸）
                            const entry = files.find((f) => f.path === k)
                            return entry !== undefined && canDiff(entry)
                        }))}
                        // 面板体懒加载语义：rc-collapse 未展开过的面板不渲染 children——
                        // RowDiff（diff 查询）展开才挂载，与「单击懒加载展开」一致
                        items={files.map((file) => ({
                            key: file.path,
                            label: <FileRowHeader sessionId={sessionId} file={file} expanded={expandedPaths.includes(file.path)} />,
                            // 只有文本类条目才有 children（不可展开项永远不会出现在 activeKey）
                            children: scopeData && canDiff(file) && (
                                <div data-testid="review-file-diff" style={{ flex: 1, minWidth: 0, display: 'flex' }}>
                                    <RowDiff sessionId={sessionId} scope={scope} entry={file} version={review.updatedAt} deps={deps} />
                                </div>
                            ),
                            styles: {
                                // 宽度 100% + 高度不限：diff 随内容自然撑开，滚动交给外层清单
                                body: {
                                    width: '100%', padding: 0, display: 'flex',
                                    background: 'var(--ant-color-bg-container)',
                                },
                            },
                        }))}
                    />
                    {scopeData && files.length === 0 && (
                        <Flex vertical style={{ padding: 12, fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>
                            {scope === 'last-turn' ? t('review.noSnapshotChanges') : t('review.empty')}
                        </Flex>
                    )}
                    {!scopeData && (
                        <Flex vertical style={{ padding: 12, fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>{t('review.noSnapshot')}</Flex>
                    )}
                </Flex>
                {treeOpen && (
                    <DiffTreePanel
                        files={files}
                        selectedPath={expandedPaths[expandedPaths.length - 1] ?? null}
                        onOpenFile={(path) => {
                            // 与主列表同闸：非文本条目点了也只选中树节点，不展开行
                            const entry = files.find((f) => f.path === path)
                            if (!entry || !canDiff(entry)) return
                            setExpandedPaths((prev) => (prev.includes(path) ? prev : [...prev, path]))
                        }}
                    />
                )}
            </Flex>
        </Flex>
    )
})
