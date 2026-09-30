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

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { App, Button, Collapse, Dropdown, Empty, Flex, Popover, Spin, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import { CheckCheck, ChevronsDownUp, ChevronDown, Columns2, Copy, ExternalLink, FileQuestion, FolderTree, MoreHorizontal, RefreshCw, WrapText } from 'lucide-react'
import { type DiffTarget, type ReviewFileEntry } from '@mobi/shared'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { basename } from '@/core/utils/path'
import { formatRelativeTime } from '@/core/utils/timeFormat'
import { copyTextToClipboard } from '@/components/chat/CopyButton'
import { FilePathLabel, KindBadge, DiffStat } from '@/components/turnDiff/present'
import { RatioSplitLayout } from '@/components/ui/SplitLayout'
import { RowDiff } from './RowDiff'
import { DiffTreePanel } from './DiffTreePanel'
import { defaultDeps, type GitReviewDeps } from './reviewDeps'
import { isDiffable, isTargetUnavailable, parseTargetKey as DiffTargetParse } from './reviewEntries'

// 对外保持原导出面（测试/消费方从 GitReviewView 取注入接口类型）
export type { GitReviewDeps } from './reviewDeps'

/** commit 档在菜单里的 key 前缀（与档位序列化键区分，onClick 按前缀分流） */
const COMMIT_ITEM_PREFIX = 'commit:'

/** 「已提交」子菜单在 scope 菜单里的 key（commit 档选中态高亮它） */
const COMMITS_MENU_KEY = 'commits'

/** 档位选项（DiffTarget 单源遍历）：菜单项 key 用稳定序列化键；「已提交」二级子菜单内选 commit */
const TARGET_OPTIONS: Array<{ target: DiffTarget; labelKey: string; disabled?: boolean }> = [
    { target: { kind: 'turn' }, labelKey: 'review.scope.lastTurn' },
    { target: { kind: 'worktree', area: 'uncommitted' }, labelKey: 'review.scope.uncommitted' },
    { target: { kind: 'worktree', area: 'unstaged' }, labelKey: 'review.scope.unstaged' },
    { target: { kind: 'worktree', area: 'staged' }, labelKey: 'review.scope.staged' },
]

/**
 * 「已提交」子菜单的滚动加载哨兵：列表滚到底（哨兵进入滚动容器视口）即翻页。
 * 后端 commit 列表是游标分页（50/页），历史很多的仓库不能一次全拉——
 * 滚动懒加载替代原「加载更多」按钮；无 IO 环境（jsdom 未 stub）静默降级为不自动翻页。
 */
function CommitLoadSentinel({ onLoad, active, loading }: { onLoad: () => void; active: boolean; loading: boolean }) {
    const ref = useRef<HTMLDivElement>(null)
    // onLoad 每渲染新引用，存 ref 避免观察器反复拆挂
    const onLoadRef = useRef(onLoad)
    onLoadRef.current = onLoad
    useEffect(() => {
        const el = ref.current
        if (!active || !el || typeof IntersectionObserver === 'undefined') return
        const io = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) onLoadRef.current()
        }, { root: el.closest('.ant-dropdown-menu-sub') })
        io.observe(el)
        return () => io.disconnect()
    }, [active])
    return (
        <div ref={ref} data-testid="review-commit-sentinel" style={{ display: 'flex', justifyContent: 'center', width: 300, padding: loading ? 6 : 0, height: loading ? undefined : 1 }}>
            {loading && <Spin size="small" />}
        </div>
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
 * 清单/树分栏壳：ratio 状态内聚在 RatioSplitLayout（拖拽流畅性见其注释）。
 */

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
    /** 移动/窄屏（<768px）不摆分栏：文件树走 Popover 弹层（与文件内容头「从树打开」同款） */
    const isMobile = useIsMobile()

    /** 把指定行滚进视口（树点文件定位用）：顶格到可视区顶部——行头 + 展开的 diff
     *  从头展示（'nearest' 会停在「行头刚好贴底」，diff 全在视口外等于没定位）；
     *  delayMs 供等 Collapse 展开动画结束——动画中行头位置未定，立即滚会停偏 */
    const revealRow = useCallback((path: string, delayMs: number) => {
        window.setTimeout(() => {
            document.querySelector(`[data-path="${CSS.escape(path)}"][data-testid="review-file-row"]`)
                ?.scrollIntoView({ block: 'start' })
        }, delayMs)
    }, [])
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

    /** 树点文件 → 主列表展开该行（与清单同闸：非文本条目不展开），返回是否真的展开。
     *  桌面分栏与移动弹层两个树入口共用；移动端按返回值决定是否收起弹层 */
    const handleTreeOpenFile = useCallback((path: string): boolean => {
        const entry = files.find((f) => f.path === path)
        if (!entry || !isDiffable(entry)) return false
        // 已展开无动画立即定位；新展开等 Collapse 动画结束再滚
        const already = expandedPaths.includes(path)
        setExpandedPaths((prev) => (prev.includes(path) ? prev : [...prev, path]))
        revealRow(path, already ? 0 : 260)
        return true
    }, [files, expandedPaths, revealRow])
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

    // 清单提为局部 ReactNode：桌面进 RatioSplitLayout 左栏，移动/窄屏满宽直渲染（同一份 JSX）
    const listNode = (
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
    )

    return (
        <Flex data-testid="git-review-view" vertical style={{ height: '100%', minHeight: 0 }}>
            {/* Header：范围切换 + 汇总统计 + 功能按钮 */}
            <Flex
                align="center"
                gap={10}
                style={{ padding: '8px 12px', borderBottom: '1px solid var(--ant-color-border-secondary)', flexShrink: 0 }}
            >
                <Dropdown
                    trigger={['click']}
                    placement="bottomLeft"
                    // 关闭即卸载 popup 树：触屏无 mouseleave 兜底，选中 commit 关主菜单后
                    // 子菜单 popup 会泄漏残留（PC 靠移开鼠标的 mouseleave 才正常）；
                    // 卸载同时清掉 openKeys 残留，避免重开时子菜单自动展开
                    destroyOnHidden
                    menu={{
                        // 触屏走 click 展开子菜单：hover 语义在触屏上靠 tap 合成的 mouseenter，
                        // 选择 commit 关闭主菜单的退场窗口里合成 mouseover 链会把子菜单再次
                        // 「复活」再随卸载消失（闪烁）；PC 保持 hover 手感
                        triggerSubMenuAction: isMobile ? 'click' : 'hover',
                        items: [
                            ...TARGET_OPTIONS.map(({ target: t2, labelKey }) => ({
                                key: JSON.stringify(t2),
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
                            // 「已提交」二级子菜单（ZCode 同款）：hover/click 展开直接列 commit，
                            // 选中即切 commit 档（非 git 目录隐藏）
                            ...(isGitRepo ? [{
                                key: COMMITS_MENU_KEY,
                                label: t('review.scope.commits'),
                                children: [
                                    // 首拉中 / 失败占位
                                    ...(commits.isLoading ? [{ key: '__loading__', disabled: true, label: <Flex justify="center" style={{ width: 300, padding: 6 }}><Spin size="small" /></Flex> }] : []),
                                    ...(commits.error ? [{ key: '__error__', disabled: true, label: commits.error }] : []),
                                    ...commits.data.map((c) => ({
                                        key: `${COMMIT_ITEM_PREFIX}${c.sha}`,
                                        disabled: c.parentSha === null,
                                        title: c.subject,
                                        label: (
                                            <span
                                                data-testid="review-commit-item"
                                                data-sha={c.sha}
                                                data-root={c.parentSha === null || undefined}
                                                style={{ display: 'flex', alignItems: 'center', gap: 8, width: 300 }}
                                            >
                                                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {c.subject}
                                                </span>
                                                <span style={{ color: 'var(--ant-color-text-tertiary)', flexShrink: 0, fontSize: 12 }}>
                                                    {formatRelativeTime(c.authorTimestamp * 1000, t)}
                                                </span>
                                            </span>
                                        ),
                                    })),
                                    // 滚动到底翻页哨兵：hasNextPage 才挂，滚近底部自动 loadMore
                                    ...(commits.hasNextPage ? [{
                                        key: '__sentinel__',
                                        disabled: true,
                                        label: <CommitLoadSentinel onLoad={commits.loadMore} active={!commits.isLoadingMore} loading={commits.isLoadingMore} />,
                                    }] : []),
                                    ...(commits.data.length === 0 && !commits.isLoading && !commits.error
                                        ? [{ key: '__empty__', disabled: true, label: t('review.empty') }]
                                        : []),
                                ],
                            }] : []),
                        ],
                        selectedKeys: [target.kind === 'commit' ? COMMITS_MENU_KEY : JSON.stringify(target)],
                        onClick: ({ key }) => {
                            if (key.startsWith(COMMIT_ITEM_PREFIX)) {
                                const c = commits.data.find((x) => x.sha === key.slice(COMMIT_ITEM_PREFIX.length))
                                if (c) changeTarget({ kind: 'commit', range: { base: c.parentSha ?? '', head: c.sha } })
                                return
                            }
                            try {
                                changeTarget(DiffTargetParse(key))
                            } catch { /* 序列化键损坏不切档 */ }
                        },
                    }}
                >
                    <Button
                        size="small" type="text"
                        data-testid="review-scope-switch"
                        aria-haspopup="menu"
                        style={{ maxWidth: 180, paddingInline: 6 }}
                    >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {target.kind === 'commit'
                                ? (() => {
                                    const c = commits.data.find((x) => x.sha === target.range.head)
                                    return c ? `${c.sha.slice(0, 7)} · ${c.subject}` : t('review.scope.commits')
                                })()
                                : t(TARGET_OPTIONS.find(({ target: t2 }) => JSON.stringify(t2) === JSON.stringify(target))?.labelKey ?? 'review.scope.commits')}
                        </span>
                        <ChevronDown size={12} style={{ flexShrink: 0, color: 'var(--ant-color-text-tertiary)' }} />
                    </Button>
                </Dropdown>
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
                {/* 右侧工具区：面板级功能按钮（新工具并列挂入，勿混进左侧摘要区）。
                    移动端四键收进「更多」Dropdown 节省横宽，桌面保持平铺 */}
                <Flex align="center" gap={2} style={{ marginLeft: 'auto' }} data-testid="review-toolbar">
                    {isMobile ? (
                        <Dropdown
                            menu={{
                                items: [
                                    { key: 'refresh', label: t('review.refresh'), icon: <RefreshCw size={14} />, disabled: overview.isFetching },
                                    { key: 'collapseAll', label: t('review.collapseAll'), icon: <ChevronsDownUp size={14} /> },
                                    { key: 'wrap', label: t('review.wrap'), icon: <WrapText size={14} /> },
                                    { key: 'layout', label: layout === 'split' ? t('review.layoutUnified') : t('review.layoutSplit'), icon: <Columns2 size={14} /> },
                                ],
                                onClick: ({ key }) => {
                                    if (key === 'refresh') overview.refetch()
                                    else if (key === 'collapseAll') setExpandedPaths([])
                                    else if (key === 'wrap') setWrap((v) => !v)
                                    else if (key === 'layout') changeLayout(layout === 'split' ? 'unified' : 'split')
                                },
                            }}
                            trigger={['click']}
                            placement="bottomRight"
                        >
                            <Button
                                type="text" size="small"
                                aria-label={t('common.more')}
                                aria-haspopup="menu"
                                data-testid="review-more"
                                icon={<MoreHorizontal size={15} style={{ color: 'var(--ant-color-text-tertiary)' }} />}
                            />
                        </Dropdown>
                    ) : (
                        <>
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
                        </>
                    )}
                    {isMobile ? (
                        /* 移动/窄屏：树按钮锚定 Popover 弹层（触屏无 hover，不叠 Tooltip，
                            与 FileContentViewHeader 的树 Popover 同款交互） */
                        <Popover
                            open={treeOpen}
                            onOpenChange={setTreeOpen}
                            trigger="click"
                            placement="bottomLeft"
                            /* 窄屏撑满横向 + 高度上限（antd.css 锁几何，quote-list-popover 同款坑：
                                anchor 对齐在窄屏算不死，必须锁死）；
                                树内容超宽交给面板内部溢出滚动 */
                            overlayClassName="review-tree-popover"
                            content={
                                <div style={{ width: '100%', height: 'min(70dvh, 560px)', overflow: 'auto' }}>
                                    <DiffTreePanel
                                        files={files}
                                        selectedPath={expandedPaths[expandedPaths.length - 1] ?? null}
                                        onOpenFile={(path) => {
                                            if (handleTreeOpenFile(path)) setTreeOpen(false)
                                        }}
                                    />
                                </div>
                            }
                        >
                            <Button
                                type="text" size="small"
                                aria-label={t('review.fileTree')}
                                aria-expanded={treeOpen}
                                data-testid="review-tree-toggle"
                                icon={<FolderTree size={15} style={{ color: treeOpen ? 'var(--ant-color-text)' : 'var(--ant-color-text-tertiary)' }} />}
                            />
                        </Popover>
                    ) : (
                        <Tooltip title={t('review.fileTree')}>
                            <Button
                                type="text" size="small"
                                aria-label={t('review.fileTree')}
                                data-testid="review-tree-toggle"
                                icon={<FolderTree size={15} style={{ color: treeOpen ? 'var(--ant-color-text)' : 'var(--ant-color-text-tertiary)' }} />}
                                onClick={() => setTreeOpen((v) => !v)}
                            />
                        </Tooltip>
                    )}
                </Flex>
            </Flex>

            {/* Content：平铺文件清单（Collapse 手风琴）。桌面 = 清单↔树可拖拽分栏
                （ratio 内聚在 RatioSplitLayout，拖拽流畅性见其注释；
                treeOpen 切展开态，树 pane 宽度过渡/淡入淡出由 SplitLayout 外壳承担）；
                移动/窄屏 = 清单满宽，文件树走 header 的 Popover 弹层，无分栏 */}
            {isMobile ? (
                <div style={{ flex: 1, minHeight: 0 }}>
                    {listNode}
                </div>
            ) : (
                <RatioSplitLayout
                    expanded={treeOpen}
                    onExpandedChange={setTreeOpen}
                    left={listNode}
                    right={
                        /* 变更文件树 pane：SplitLayout 右栏外壳承担宽度过渡与淡入淡出，
                            收起仅折叠不销毁——筛选/展开状态在开合往返间保留 */
                        <div data-testid="review-tree-holder" aria-hidden={!treeOpen} style={{ height: '100%', overflow: 'hidden' }}>
                            <DiffTreePanel
                                files={files}
                                selectedPath={expandedPaths[expandedPaths.length - 1] ?? null}
                                onOpenFile={handleTreeOpenFile}
                            />
                        </div>
                    }
                />
            )}
        </Flex>
    )
})
