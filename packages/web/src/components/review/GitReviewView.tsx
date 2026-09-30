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
 * 审查视图（inspector「审查」tab；审查重写 v2 票05 最小适配）：顶部 header（目标切换 +
 * 汇总统计 + 右侧功能按钮），content 平铺文件列表（单击懒加载展开该文件 diff，
 * 多开不互斥），可开合右侧 diff 文件树面板（筛选 + 目录树，与文件
 * 目录树同款交互）。档位寻址 = DiffTarget（turn/worktree/commit，shared 单源）。
 * 档位受控——inspector 侧挂 tab viewState 持久化，组件自身保持可测
 * （数据经 deps 注入的 hooks 拉取，测试注入假数据不碰网络）。
 *
 * 子模块：reviewEntries（可展开/查询语义纯函数）、reviewDeps（数据注入点）、
 * RowDiff（行内 diff 区）、DiffTreePanel（右侧文件树）。本文件只留视图主体与文件行头。
 */

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { App, Button, Collapse, Empty, Flex, Popover, Select, Spin, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import { CheckCheck, ChevronsDownUp, ChevronDown, Columns2, Copy, ExternalLink, FileQuestion, FolderTree, RefreshCw, WrapText } from 'lucide-react'
import { type DiffTarget, type ReviewCommit, type ReviewFileEntry } from '@mobi/shared'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'
import { basename } from '@/core/utils/path'
import { formatRelativeTime } from '@/core/utils/timeFormat'
import { copyTextToClipboard } from '@/components/chat/CopyButton'
import { FilePathLabel, KindBadge, DiffStat } from '@/components/turnDiff/present'
import { SplitLayout } from '@/components/ui/SplitLayout'
import { RowDiff } from './RowDiff'
import { DiffTreePanel } from './DiffTreePanel'
import { defaultDeps, type GitReviewDeps } from './reviewDeps'
import { isDiffable, isTargetUnavailable, parseTargetKey as DiffTargetParse } from './reviewEntries'

// 对外保持原导出面（测试/消费方从 GitReviewView 取注入接口类型）
export type { GitReviewDeps } from './reviewDeps'

/** commit 档在 Select 序列化键里的占位（选中它不切档，只弹 commit 选择面板） */
const COMMIT_OPTION_KEY = '__commits__'

/** 档位选项（DiffTarget 单源遍历）：Select 的 value 用稳定序列化键；「提交…」占位项票 06 实现 */
const TARGET_OPTIONS: Array<{ target: DiffTarget; labelKey: string; disabled?: boolean }> = [
    { target: { kind: 'turn' }, labelKey: 'review.scope.lastTurn' },
    { target: { kind: 'worktree', area: 'uncommitted' }, labelKey: 'review.scope.uncommitted' },
    { target: { kind: 'worktree', area: 'unstaged' }, labelKey: 'review.scope.unstaged' },
    { target: { kind: 'worktree', area: 'staged' }, labelKey: 'review.scope.staged' },
]

/** commit 选择面板（Popover 内嵌列表，票06）：短 sha · subject · 相对时间 + 加载更多。
 *  根提交（无父）不可选——commit 档 diff 语义是 parent..head，根提交没有 parent */
function CommitPicker({ commits, selectedHead, onPick, onLoadMore, hasNextPage, isLoadingMore, isLoading, error }: {
    commits: ReviewCommit[]
    selectedHead: string | null
    onPick: (commit: ReviewCommit) => void
    onLoadMore: () => void
    hasNextPage: boolean
    isLoadingMore: boolean
    isLoading: boolean
    error: string | null
}) {
    const { t } = useTranslation()
    if (isLoading) {
        return <Flex align="center" justify="center" style={{ width: 260, height: 120 }}><Spin size="small" /></Flex>
    }
    if (error) {
        return <Flex style={{ width: 260, padding: 12, fontSize: 12, color: 'var(--ant-color-error)' }}>{error}</Flex>
    }
    return (
        <Flex vertical data-testid="review-commit-picker" style={{ width: 280, maxHeight: 320 }}>
            <Flex vertical style={{ overflowY: 'auto', minHeight: 0 }}>
                {commits.map((commit) => {
                    const rootCommit = commit.parentSha === null
                    const selected = commit.sha === selectedHead
                    return (
                        <button
                            key={commit.sha}
                            type="button"
                            disabled={rootCommit}
                            data-testid="review-commit-item"
                            data-sha={commit.sha}
                            onClick={() => !rootCommit && onPick(commit)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                width: '100%', padding: '5px 8px', border: 'none', cursor: rootCommit ? 'not-allowed' : 'pointer',
                                textAlign: 'left', background: selected ? 'var(--ant-color-fill-tertiary)' : 'transparent',
                                borderRadius: 6, fontSize: 12, color: 'var(--ant-color-text)',
                            }}
                        >
                            <span style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--ant-color-text-secondary)', flexShrink: 0 }}>
                                {commit.sha.slice(0, 7)}
                            </span>
                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {commit.subject}
                            </span>
                            <span style={{ color: 'var(--ant-color-text-tertiary)', flexShrink: 0 }}>
                                {formatRelativeTime(commit.authorTimestamp * 1000, t)}
                            </span>
                        </button>
                    )
                })}
                {commits.length === 0 && (
                    <Flex style={{ padding: 12, fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>{t('review.empty')}</Flex>
                )}
            </Flex>
            {hasNextPage && (
                <Button
                    size="small" type="text"
                    data-testid="review-commit-load-more"
                    loading={isLoadingMore}
                    onClick={onLoadMore}
                    style={{ marginTop: 4 }}
                >
                    {t('review.loadMore')}
                </Button>
            )}
        </Flex>
    )
}

/** 非 git 目录空态（票06）：说明 + 一键 init，成功后总览失效五档上线 */
function NonGitEmptyState({ onInit, pending }: { onInit: () => void; pending: boolean }) {
    const { t } = useTranslation()
    return (
        <Flex vertical align="center" justify="center" gap={12} style={{ height: '100%', padding: 24 }}>
            <FileQuestion size={36} color="var(--ant-color-text-quaternary)" />
            <span style={{ fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>{t('review.needsGit')}</span>
            <Button size="small" data-testid="review-init-git" loading={pending} onClick={onInit}>
                {t('review.initRepo')}
            </Button>
        </Flex>
    )
}

/** 手风琴文件行的头（Collapse label）：徽标/路径 + 紧随其后的统计与展开箭头（均 hover 显现），
 *  行尾 hover 操作（复制/打开标签页）。Collapse 自带展开图标关闭（expandIcon=null） */
/**
 * 清单/树分栏：与会话页「聊天 ↔ 检查器」同一套 SplitLayout（宽度过渡裁剪 + 可拖拽
 * ratio + 拖到右缘自动收起）。ratio 状态内聚在此——若上提 GitReviewView，拖拽每帧
 * setState 会拖着 61 行清单全量重渲（实测非常卡）；挪到本组件后拖拽只重渲分栏壳，
 * children 元素引用不变，React 对清单子树直接 bail out
 */
const ReviewSplitter = memo(function ReviewSplitter({ treeOpen, onTreeOpenChange, list, tree }: {
    treeOpen: boolean
    /** 拖到右缘自动收起（SplitLayout shouldCollapseOnDrag）回传父组件 */
    onTreeOpenChange: (open: boolean) => void
    list: ReactNode
    tree: ReactNode
}) {
    /** 左侧（清单）占比：0.8 即树 pane 默认约 20% 宽；拖拽后沿用最近值，开合往返不丢 */
    const [splitRatio, setSplitRatio] = useState(0.8)
    return (
        <div style={{ flex: 1, minHeight: 0 }}>
            <SplitLayout
                left={list}
                right={tree}
                expanded={treeOpen}
                splitRatio={splitRatio}
                secondaryMaximized={false}
                onExpandedChange={onTreeOpenChange}
                onSplitRatioChange={setSplitRatio}
                defaultSplitRatio={0.8}
            />
        </div>
    )
})

function FileRowHeader({ sessionId, file, expanded, pending }: { sessionId: string; file: ReviewFileEntry; expanded: boolean; pending?: boolean }) {
    const { t } = useTranslation()
    const isDark = useUiStore((s) => resolveTheme(s.theme) === 'dark')
    const openFileTab = useWorkspaceStore((s) => s.openFileTab)

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
            // lineHeight 收紧：徽标/mono 路径/统计三档字号混排时，antd 继承的 22px 行盒
            // 让不同字体的 baseline 错位（徽标视觉偏离行中心）；小行高 + flex 居中即对齐
            style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, lineHeight: 1.2 }}
        >
            <KindBadge kind={file.kind} isDark={isDark} fontSize={12} />
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
            <DiffStat additions={file.additions ?? 0} deletions={file.deletions ?? 0} binary={file.binary} fontSize={12} />
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
                不可展开的条目（非文本）不给箭头——行本身不响应展开。
                请求中：箭头位置换 loading 指示（RowDiff 上报 pending，就绪还原） */}
            {isDiffable(file) && (
                <span className="review-row-chevron" style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', color: 'var(--ant-color-text-tertiary)' }}>
                    {pending ? (
                        <Spin size="small" data-testid="review-row-loading" />
                    ) : (
                        <ChevronDown
                            size={13}
                            style={{
                                transform: expanded ? 'none' : 'rotate(-90deg)',
                                transition: `transform var(--ant-motion-duration-mid, 0.2s) var(--ant-motion-ease-in-out, ease)`,
                            }}
                        />
                    )}
                </span>
            )}
        </div>
    )
}

export const GitReviewView = memo(function GitReviewView({ sessionId, target: targetProp, onTargetChange, layout: layoutProp, onLayoutChange, deps = defaultDeps }: {
    sessionId: string
    /** 受控审查目标（inspector 经 tab viewState 持久化）；缺省「上一轮」 */
    target?: DiffTarget
    onTargetChange?: (t: DiffTarget) => void
    /** 受控 diff 布局（票06，inspector 经 tab viewState 持久化）；缺省 unified */
    layout?: 'unified' | 'split'
    onLayoutChange?: (l: 'unified' | 'split') => void
    deps?: GitReviewDeps
}) {
    const { t } = useTranslation()
    const { message } = App.useApp()
    const [targetState, setTargetState] = useState<DiffTarget>({ kind: 'turn' })
    const target = targetProp ?? targetState
    const changeTarget = onTargetChange ?? setTargetState
    const [layoutState, setLayoutState] = useState<'unified' | 'split'>('unified')
    const layout = layoutProp ?? layoutState
    const changeLayout = onLayoutChange ?? setLayoutState

    const overview = deps.useReviewOverview(sessionId)
    const running = deps.useSessionRunning(sessionId)
    const commits = deps.useReviewCommits(sessionId)
    const initGit = deps.useReviewInit(sessionId)
    /** 多开：当前展开 diff 的文件路径集合（默认全收起，交给用户点开） */
    const [expandedPaths, setExpandedPaths] = useState<string[]>([])
    /** 展开行 patch 查询 pending 集合（RowDiff 上报；行头 loading 指示的来源） */
    const [pendingPaths, setPendingPaths] = useState<ReadonlySet<string>>(() => new Set())
    const reportPending = useCallback((path: string, pending: boolean) => {
        setPendingPaths((prev) => {
            if (prev.has(path) === pending) return prev
            const next = new Set(prev)
            if (pending) next.add(path)
            else next.delete(path)
            return next
        })
    }, [])
    const [treeOpen, setTreeOpen] = useState(false)

    /** 把指定行滚进视口（树点文件定位用）：顶格到可视区顶部——行头 + 展开的 diff
     *  从头展示（'nearest' 会停在「行头刚好贴底」，diff 全在视口外等于没定位）；
     *  delayMs 供等 Collapse 展开动画结束——动画中行头位置未定，立即滚会停偏 */
    const revealRow = useCallback((path: string, delayMs: number) => {
        window.setTimeout(() => {
            document.querySelector(`[data-path="${CSS.escape(path)}"][data-testid="review-file-row"]`)
                ?.scrollIntoView({ block: 'start' })
        }, delayMs)
    }, [])
    /** commit 选择面板（Select 点「提交…」弹出，非下拉） */
    const [commitsOpen, setCommitsOpen] = useState(false)
    /** diff 自动换行（默认开，保持既有行为；关闭后长行横向滚动） */
    const [wrap, setWrap] = useState(true)

    // init 失败 toast（mutation 错误文案）；成功 toast 一次性（succeededAt 变化沿触发）
    const succeededAtRef = useRef(0)
    useEffect(() => {
        if (initGit.error) void message.error(initGit.error)
    }, [initGit.error, message])
    useEffect(() => {
        if (initGit.succeededAt && initGit.succeededAt !== succeededAtRef.current) {
            succeededAtRef.current = initGit.succeededAt
            void message.success(t('review.initRepoSuccess'))
        }
    }, [initGit.succeededAt, message, t])

    // 审查数据是易变工作区事实：tab 常挂不卸载，靠「running→idle 翻转」驱动 refetch——
    // 开着审查 tab 跑新轮次，turn 结束后上一轮档自动刷新（E2E 实证缺失此刷新的坑）
    const wasRunningRef = useRef(false)
    useEffect(() => {
        const isRunning = running ?? false
        if (wasRunningRef.current && !isRunning) overview.refetch()
        wasRunningRef.current = isRunning
    }, [running, overview])

    // 文件明细随总览的数据版本（targetGeneration）换缓存键：总览刷新 → 明细自动重查
    const filesResult = deps.useReviewFiles(sessionId, isTargetUnavailable(overview.data, target) ? null : target, overview.data?.targetGeneration ?? '')
    const scopeData = filesResult.data ?? null
    const files = scopeData?.files ?? []
    // 切档位清空展开（各档文件集不同，跨档残留无意义）
    useEffect(() => {
        setExpandedPaths([])
    }, [JSON.stringify(target)])

    // 幽灵清理：清单刷新后已消失的 path 从展开态剔除——否则换回原清单时该行无声复活
    // （ZCode GitPane 同款语义；scopeData null 是加载中，跳过防误清）
    useEffect(() => {
        if (!scopeData) return
        setExpandedPaths((prev) => {
            const next = prev.filter((p) => files.some((f) => f.path === p))
            return next.length === prev.length ? prev : next
        })
    }, [scopeData, files])

    // 「上一轮」无快照链（会话无轮次变更消息）→ 禁用该档（空态文案诚实，不装死数据）
    const lastTurnMissing = overview.data?.scopes.turn === null
    // 非 git 目录：git 系档禁用/隐藏，commit 选择器一并隐藏（仅 turn 可用）
    const isGitRepo = overview.data?.isGitRepository !== false

    if (overview.isLoading) {
        return (
            <Flex data-testid="git-review-view" align="center" justify="center" gap={8} style={{ height: '100%', fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>
                <Spin size="small" />
                {t('review.loading')}
            </Flex>
        )
    }
    if (overview.error) {
        return (
            <Flex data-testid="git-review-view" align="center" justify="center" style={{ height: '100%' }}>
                <Empty image={<FileQuestion size={36} color="var(--ant-color-text-quaternary)" />} description={<span style={{ fontSize: 12 }}>{overview.error}</span>} />
            </Flex>
        )
    }
    if (filesResult.error) {
        return (
            <Flex data-testid="git-review-view" align="center" justify="center" style={{ height: '100%' }}>
                <Empty image={<FileQuestion size={36} color="var(--ant-color-text-quaternary)" />} description={<span style={{ fontSize: 12 }}>{filesResult.error}</span>} />
            </Flex>
        )
    }
    // 逐档可用性（非 git 目录 turn 档仍可用——工具层降级源；git 系档诚实空态 + 一键 init）
    if (isTargetUnavailable(overview.data, target)) {
        if (overview.data?.isGitRepository === false) {
            return (
                <Flex data-testid="git-review-view" vertical style={{ height: '100%' }}>
                    <NonGitEmptyState onInit={initGit.init} pending={initGit.isPending} />
                </Flex>
            )
        }
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
                <Popover
                    open={commitsOpen}
                    onOpenChange={(visible) => {
                        // 点击锚点本身的 open 请求一律不理（Select 点开的是档位下拉）；
                        // 面板只由「提交…」选项点选打开，外点关闭
                        if (!visible) setCommitsOpen(false)
                    }}
                    trigger={['click']}
                    placement="bottomLeft"
                    content={
                        <CommitPicker
                            commits={commits.data}
                            selectedHead={target.kind === 'commit' ? target.range.head : null}
                            onPick={(c) => {
                                setCommitsOpen(false)
                                changeTarget({ kind: 'commit', range: { base: c.parentSha ?? '', head: c.sha } })
                            }}
                            onLoadMore={commits.loadMore}
                            hasNextPage={commits.hasNextPage}
                            isLoadingMore={commits.isLoadingMore}
                            isLoading={commits.isLoading}
                            error={commits.error}
                        />
                    }
                >
                    <Select
                        size="small"
                        value={JSON.stringify(target)}
                        onChange={(v) => {
                            // 「提交…」项不切档，只弹 commit 选择面板
                            if (v === COMMIT_OPTION_KEY) {
                                setCommitsOpen(true)
                                return
                            }
                            try {
                                changeTarget(DiffTargetParse(v as string))
                            } catch { /* 序列化键损坏不切档 */ }
                        }}
                        style={{ width: 128 }}
                        popupMatchSelectWidth={false}
                        labelRender={({ label, value }) => {
                            // commit 档显示 短sha · 截断 subject（非 commit 档走默认 label）
                            if (target.kind === 'commit') {
                                const c = commits.data.find((x) => x.sha === target.range.head)
                                const text = c ? `${c.sha.slice(0, 7)} · ${c.subject}` : t('review.scope.commits')
                                return <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
                            }
                            return label ?? String(value)
                        }}
                        options={[
                            ...TARGET_OPTIONS.map(({ target: t2, labelKey }) => ({
                                value: JSON.stringify(t2),
                                label: (
                                    <span>
                                        {t(labelKey)}
                                        {!isGitRepo && t2.kind !== 'turn' && (
                                            <span style={{ color: 'var(--ant-color-text-quaternary)' }}> · {t('review.needsGit')}</span>
                                        )}
                                    </span>
                                ),
                                disabled: (t2.kind === 'turn' && lastTurnMissing) || (!isGitRepo && t2.kind !== 'turn'),
                            })),
                            // 「提交…」→ commit 选择面板（非 git 目录隐藏）
                            ...(isGitRepo ? [{ value: COMMIT_OPTION_KEY, label: t('review.scope.commits') }] : []),
                        ]}
                        data-testid="review-scope-switch"
                    />
                </Popover>
                {scopeData && (
                    <span style={{ fontSize: 12, fontFamily: 'var(--font-mono, monospace)', whiteSpace: 'nowrap' }}>
                        <span style={{ color: 'var(--ant-color-text-secondary)' }}>{t('review.fileCount', { count: scopeData.stats.files })}</span>{' '}
                        <DiffStat additions={scopeData.stats.additions} deletions={scopeData.stats.deletions} fontSize={12} />
                        {scopeData.truncated && (
                            <Tooltip title={t('review.truncated')}>
                                <span style={{ marginLeft: 6, color: 'var(--ant-color-text-tertiary)', cursor: 'help' }}>…</span>
                            </Tooltip>
                        )}
                    </span>
                )}
                <Flex flex={1} />
                {/* 右侧工具区：面板级功能按钮（新工具并列挂入，勿混进左侧摘要区） */}
                <Flex align="center" gap={2} style={{ marginLeft: 'auto' }} data-testid="review-toolbar">
                    <Tooltip title={t('review.refresh')}>
                        <Button
                            type="text" size="small"
                            aria-label={t('review.refresh')}
                            data-testid="review-refresh"
                            icon={
                                <RefreshCw
                                    size={15}
                                    style={{
                                        color: 'var(--ant-color-text-tertiary)',
                                        // 取数中转圈（CSS animation，同 TeamAgentPanel/TasksPanel 先例）
                                        animation: overview.isFetching ? 'review-refresh-spin 1s linear infinite' : undefined,
                                    }}
                                />
                            }
                            onClick={() => overview.refetch()}
                        />
                    </Tooltip>
                    <Tooltip title={t('review.collapseAll')}>
                        <Button
                            type="text" size="small"
                            aria-label={t('review.collapseAll')}
                            data-testid="review-collapse-all"
                            icon={<ChevronsDownUp size={15} style={{ color: 'var(--ant-color-text-tertiary)' }} />}
                            onClick={() => setExpandedPaths([])}
                        />
                    </Tooltip>
                    <Tooltip title={t('review.wrap')}>
                        <Button
                            type="text" size="small"
                            aria-label={t('review.wrap')}
                            data-testid="review-wrap-toggle"
                            icon={<WrapText size={15} style={{ color: wrap ? 'var(--ant-color-text)' : 'var(--ant-color-text-tertiary)' }} />}
                            onClick={() => setWrap((v) => !v)}
                        />
                    </Tooltip>
                    <Tooltip title={layout === 'split' ? t('review.layoutUnified') : t('review.layoutSplit')}>
                        <Button
                            type="text" size="small"
                            aria-label={layout === 'split' ? t('review.layoutUnified') : t('review.layoutSplit')}
                            data-testid="review-layout-toggle"
                            icon={<Columns2 size={15} style={{ color: layout === 'split' ? 'var(--ant-color-text)' : 'var(--ant-color-text-tertiary)' }} />}
                            onClick={() => changeLayout(layout === 'split' ? 'unified' : 'split')}
                        />
                    </Tooltip>
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
            </Flex>

            {/* Content：平铺文件清单（Collapse 手风琴）+ 可拖拽调宽的 diff 文件树。
                分栏壳与拖拽状态内聚在 ReviewSplitter（拖拽流畅性见其注释）；
                treeOpen 切展开态，树 pane 宽度过渡/淡入淡出由 SplitLayout 外壳承担 */}
            <ReviewSplitter
                treeOpen={treeOpen}
                onTreeOpenChange={setTreeOpen}
                list={
                    <Flex vertical style={{ height: '100%', overflowY: 'auto' }}>
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
                            return entry !== undefined && isDiffable(entry)
                        }))}
                        // 面板体懒加载语义：rc-collapse 未展开过的面板不渲染 children——
                        // RowDiff（diff 查询）展开才挂载，与「单击懒加载展开」一致
                        items={files.map((file) => ({
                            key: file.path,
                            label: <FileRowHeader sessionId={sessionId} file={file} expanded={expandedPaths.includes(file.path)} pending={pendingPaths.has(file.path)} />,
                            // 只有文本类条目才有 children（不可展开项永远不会出现在 activeKey）
                            children: scopeData && isDiffable(file) && (
                                <div data-testid="review-file-diff" style={{ flex: 1, minWidth: 0, display: 'flex' }}>
                                    <RowDiff
                                        sessionId={sessionId}
                                        target={target}
                                        entry={file}
                                        version={overview.data?.targetGeneration ?? ''}
                                        deps={deps}
                                        wrap={wrap}
                                        layout={layout}
                                        onPendingChange={reportPending}
                                    />
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
                            {target.kind === 'turn' ? t('review.noSnapshotChanges') : t('review.empty')}
                        </Flex>
                    )}
                    {!scopeData && (
                        <Flex vertical style={{ padding: 12, fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>
                            {target.kind === 'turn' ? t('review.noSnapshot') : t('review.empty')}
                        </Flex>
                    )}
                </Flex>
                }
                tree={
                    /* 变更文件树 pane：SplitLayout 右栏外壳承担宽度过渡与淡入淡出，
                        收起仅折叠不销毁——筛选/展开状态在开合往返间保留 */
                    <div data-testid="review-tree-holder" aria-hidden={!treeOpen} style={{ height: '100%', overflow: 'hidden' }}>
                        <DiffTreePanel
                            files={files}
                            selectedPath={expandedPaths[expandedPaths.length - 1] ?? null}
                            onOpenFile={(path) => {
                                // 与主列表同闸：非文本条目点了也只选中树节点，不展开行
                                const entry = files.find((f) => f.path === path)
                                if (!entry || !isDiffable(entry)) return
                                // 已展开无动画立即定位；新展开等 Collapse 动画结束再滚
                                const already = expandedPaths.includes(path)
                                setExpandedPaths((prev) => (prev.includes(path) ? prev : [...prev, path]))
                                revealRow(path, already ? 0 : 260)
                            }}
                        />
                    </div>
                }
            />
        </Flex>
    )
})
