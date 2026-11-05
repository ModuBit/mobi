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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { App, Input, Listy, Modal, Spin, theme as antTheme } from 'antd'
import { Archive as ArchiveIcon, ArchiveRestore, Clock, Folder, MoreHorizontal, Search, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import { useArchivedSessions } from '@/core/data/hooks/queries/useArchivedSessions'
import { useWorkspaces } from '@/core/data/hooks/queries/useWorkspaces'
import { useSessionArchive } from '@/core/data/hooks/mutations/useSessionArchive'
import { Button } from '@/ui/base/interactive/button/Button'
import { Select } from '@/ui/base/interactive/select/Select'
import { DropdownMenu } from '@/ui/base/interactive/dropdown-menu/DropdownMenu'
import { formatMessageTime } from '@/core/utils/timeFormat'
import { getSessionDisplayName } from '@/core/utils/sessionUtils'
import { reportBlockedError } from '@/core/data/sessionDormancy'
import { invalidateSessionViews } from '@/core/lib/invalidateViews'
import { evictSession } from '@/core/lib/sessionEviction'
import { useSessionDelete } from './useSessionDelete'
import { summarizeBatch, batchConfirmExpected, BATCH_DELETE_CONFIRM_TOKEN } from './archivedBatch'
import type { BatchItemResult } from './archivedBatch'
import { groupAndAnnotate } from './archivedGrouping'
import type { AnnotatedRow } from './archivedGrouping'
import { RectHoverGlideLayer } from '@/ui/base/motion/RectHoverGlideLayer'
import { useMobiApi } from '@/core/data/api/client'
import { useQueryClient } from '@tanstack/react-query'
import type { Session } from '@/core/data/api/types'

const { useToken } = antTheme

/**
 * 页面壳（票 09 分页改造）：不再页面级滚动——滚动容器移交 Listy（虚拟滚动 +
 * 触底加载），壳只做 flex 纵向布局与安全区内衬。
 */
const PageShell = styled.div`
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 12px 20px max(24px, env(safe-area-inset-bottom));
`

const Inner = styled.div`
    flex: 1;
    min-height: 0;
    width: 100%;
    max-width: 860px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
`

/* 页面标题行（兼头部锚位行）：左侧锚位（PC 侧栏开关 / 移动端汉堡）+ 大标题，
 * 「全部删除」钉右缘同一基线——单行承载，不再单独占一条头部横条 */
const TitleRow = styled.div<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 48px;
    padding: 10px 0 16px;

    /* 移动端 PWA standalone 顶部贴状态栏，避让刘海区域（对齐 PageHeader 的避让规则） */
    @media (hover: none) and (pointer: coarse) {
        padding-top: max(10px, env(safe-area-inset-top));
    }

    .title-delete-all {
        margin-left: auto;
    }
`

const TitleAnchorSlot = styled.div`
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
`

const PageTitle = styled.h1<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    margin: 0;
    font-size: 28px;
    font-weight: 600;
    color: ${p => p.$token.colorText};

    /* 移动端对齐设置页头部标题（Title level 5 = 16px），断点同 SETTINGS_WIDE_QUERY */
    @media (max-width: 991.98px) {
        font-size: 16px;
    }
`

/* 工具条：搜索（占位，功能后续接入）+ 项目过滤 */
const ToolBar = styled.div`
    display: flex;
    align-items: center;
    gap: 10px;
    padding-bottom: 18px;
    flex-shrink: 0;
`

const SearchSlot = styled(Input)`
    flex: 1;
    min-width: 0;
`

const WorkspaceFilter = styled(Select)`
    width: 160px;
    flex-shrink: 0;
`

/**
 * Listy 容器（虚拟滚动的量高基准）：色块卡视觉全部由行元素（ArchivedRow）按
 * group-first/group-last 类直接命中——不从 item 容器用 :has() 回查（祖先选择器在
 * 虚拟滚动每帧增删行时触发全量样式重验证，移动端滚动肉眼卡顿），也不做 DOM 邻接
 * 推断（虚拟化下相邻关系不可靠）。行序列由 groupAndAnnotate 在数据层聚类成
 * 「同组连续」，Listy 的 group 聚类重排退化为恒等，边界标注与视觉位置一致。
 */
const ListyShell = styled.div<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    flex: 1;
    min-height: 0;
    position: relative;
    /* 滑移底色层（RectHoverGlideLayer）的 z-index 分层在此容器内成立 */
    isolation: isolate;

    /* item 容器透明零内衬零边框（卡片视觉在行内 RowSurface 上；antd 默认带
     * 12px 16px padding + 1px colorSplit borderBottom + hover 背景，见 RowSurface 注释） */
    .archived-listy-item {
        background: transparent;
        padding: 0;
        border-bottom: 0;
    }
    .archived-listy-item:hover {
        background: transparent;
    }

    /* 滑移底色层序：RowSurface(0) < GlideFill(1) < 行内容(2) */
    .archived-glide-fill {
        z-index: 1;
    }

    /* 组头裸排页面背景（ChatGPT 形态）：重置 antd 默认背景/内衬，组间 28px 承载在
     * 组头顶距上（首个免） */
    .archived-listy-header {
        background: transparent;
        padding: 28px 4px 12px;
    }
    .archived-listy-header:first-child {
        padding-top: 0;
    }
`

/** 手动分页行：列表下方的居中动作行（「加载更多」按钮 / 加载中指示） */
const LoadMoreRow = styled.div`
    display: flex;
    justify-content: center;
    padding: 12px 0 4px;
`

/** 加载中指示：浅色胶囊（双档主题各自可读） */
const LoadMorePill = styled.div<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 14px;
    border-radius: var(--radius-pill);
    border: 1px solid ${p => p.$token.colorBorderSecondary};
    background: ${p => p.$token.colorBgContainer};
    font-size: 12px;
    color: ${p => p.$token.colorTextSecondary};
`

/* 组头（项目名 + 真实计数 + ⋯ 菜单）：hover 显示动作（触屏常驻），下拉面板打开期间不隐藏 */
const GroupHeader = styled.div<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 4px 12px;
    font-size: 14px;
    font-weight: 600;
    color: ${p => p.$token.colorText};
    user-select: none;

    .group-actions {
        visibility: hidden;
    }
    &:hover .group-actions,
    .group-actions:focus-within,
    .group-actions:has([data-state='open']) {
        visibility: visible;
    }
    @media (hover: none) {
        .group-actions {
            visibility: visible;
        }
    }
`

const GroupCount = styled.span<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    margin-left: auto;
    font-weight: 400;
    font-size: 12px;
    color: ${p => p.$token.colorTextQuaternary};
`

const GroupActions = styled.span`
    display: inline-flex;
    align-items: center;
    margin-left: 4px;
`

const GroupActionButton = styled.button<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    background: transparent;
    color: ${p => p.$token.colorTextTertiary};
    border-radius: var(--radius-icon);
    cursor: pointer;
    transition: color 0.15s, background 0.15s;

    &:hover {
        color: ${p => p.$token.colorText};
        background: ${p => p.$token.colorBgTextHover};
    }
`

/** 行容器：布局与留白；卡底视觉全在 RowSurface 上（给滑移底色让出层序：surface 0 < fill 1 < 内容 2） */
const ArchivedRow = styled.div<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    color: ${p => p.$token.colorText};
`

/**
 * 行卡白底层：背景/侧壁/组边界圆角与 hairline 按组边界类直接命中（不用 :has()）。
 * 独立成层是为了滑移 hover——RectHoverGlideLayer 的底色块（z:1）盖在这层之上、
 * 行内容（z:2）之下，滑到哪行哪行显底色且被 border-radius 天然裁剪。
 * 单行组（first+last 同在）需四角全圆——该规则必须声明在 first/last 两条之后，
 * 否则 border-radius 被后者覆盖、上圆角变直角。
 */
const RowSurface = styled.div<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    position: absolute;
    inset: 0;
    z-index: 0;
    background: ${p => p.$token.colorBgContainer};
    border-left: 1px solid ${p => p.$token.colorBorderSecondary};
    border-right: 1px solid ${p => p.$token.colorBorderSecondary};

    /* 组内首行收卡顶，其余行画行间 hairline，末行收卡底 */
    &.group-first {
        border-top: 1px solid ${p => p.$token.colorBorderSecondary};
        border-radius: var(--radius-panel) var(--radius-panel) 0 0;
    }
    &:not(.group-first) {
        border-top: 1px solid ${p => p.$token.colorBorderSecondary};
    }
    &.group-last {
        border-bottom: 1px solid ${p => p.$token.colorBorderSecondary};
        border-radius: 0 0 var(--radius-panel) var(--radius-panel);
    }
    &.group-first.group-last {
        border-radius: var(--radius-panel);
    }
`

/** 名称主行 + 归档时间副行（时间是名称的补充信息，窄屏不再挤压名称）。z:2 压过滑移底色层 */
const RowMain = styled.div`
    position: relative;
    z-index: 2;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
`

const RowName = styled.span`
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

const RowTime = styled.span<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: ${p => p.$token.colorTextQuaternary};
    white-space: nowrap;
    overflow: hidden;

    /* 移动端双时间挤不下 12px：缩字号保两段完整（断点同 SETTINGS_WIDE_QUERY） */
    @media (max-width: 991.98px) {
        font-size: 11.5px;
        gap: 6px;
    }
`

/** 单段时间：icon 标注语义 + 时间文本（icon 与文本同色，title 承载悬停说明） */
const TimeChunk = styled.span`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
`

const RowActions = styled.span`
    position: relative;
    z-index: 2;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;

    @media (max-width: 991.98px) {
        gap: 6px;
    }
`

const RowDeleteButton = styled.button<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    background: transparent;
    color: ${p => p.$token.colorTextTertiary};
    border-radius: var(--radius-icon);
    cursor: pointer;
    transition: color 0.15s, background 0.15s;

    &:hover {
        color: ${p => p.$token.colorError};
        background: ${p => p.$token.colorBgTextHover};
    }
`

const NoMatchRow = styled.div<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    padding: 32px 0;
    text-align: center;
    font-size: 12.5px;
    color: ${p => p.$token.colorTextQuaternary};
`

const EmptyState = styled.div<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: ${p => p.$token.colorTextQuaternary};
    padding-bottom: 15dvh;
`

/** 待确认的批量删除：组级（输入项目名）或页面级（输入 DELETE）；count 是范围真实总数 */
interface PendingBatchDelete {
    scope:
        | { kind: 'group'; groupName: string; workspaceId: string | null; count: number }
        | { kind: 'page'; count: number }
}

const WORKSPACE_ALL = '__all__'
const WORKSPACE_NONE = '__none__'

interface ArchivedSessionsPageProps {
    /** 头部锚位（PC 侧栏开关 / 移动端汉堡），渲染进标题行左缘——本页无独立头部横条 */
    headerLeft?: ReactNode
}

/**
 * 归档页本体（票 05/08/09）：数据走 daemon 游标分页（归档时间倒序，项目过滤下推），
 * antd Listy 承载渲染——虚拟滚动（virtual + ResizeObserver 量高）、按工作区分组、
 * 触底加载下一页；组头（项目名 + 真实总数 + ⋯ 菜单）裸排在页面背景上（色块外，
 * ChatGPT 形态），色块卡只包行列表。批量删除/批量取消归档走 daemon 批量端点，
 * 范围 = 当前过滤条件（不是「已加载页」）——「全部删除」保持真全删语义。
 * 删除（单条/组级/页面级）保留输入确认与逐条报告。
 * 组装壳（页面容器）在 pages/ArchivedPage，本组件只管列表呈现。
 */
export function ArchivedSessionsPage({ headerLeft }: ArchivedSessionsPageProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const { message: messageApi, notification } = App.useApp()
    const api = useMobiApi()
    const queryClient = useQueryClient()
    const { data: workspaces = [] } = useWorkspaces()
    const { unarchive } = useSessionArchive()
    const confirmDelete = useSessionDelete()

    // ── 过滤（搜索占位待接入，先只有项目维度；过滤下推 daemon，切换即从第一页重拉）──
    const [workspaceFilter, setWorkspaceFilter] = useState<string>(WORKSPACE_ALL)
    // ── 批量删除确认（自管 Modal：antd modal.confirm 的受控 Input 联动 fragile）──
    const [pendingDelete, setPendingDelete] = useState<PendingBatchDelete | null>(null)
    const [batchRunning, setBatchRunning] = useState(false)

    const {
        data,
        isLoading,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useArchivedSessions(workspaceFilter === WORKSPACE_ALL ? undefined : workspaceFilter)

    // 扁平化 + 跨页去重（tie-skip 瞬时边界可能让相邻页出现重复行，rowKey 冲突防御）
    const sessions = useMemo(() => {
        const seen = new Set<string>()
        const out: Session[] = []
        for (const page of data?.pages ?? []) {
            for (const session of page.sessions) {
                if (seen.has(session.id)) continue
                seen.add(session.id)
                out.push(session)
            }
        }
        return out
    }, [data])
    const annotated = useMemo(() => groupAndAnnotate(sessions), [sessions])

    // 组计数 / 全集总数取最后页快照（每页响应都带全集统计）
    const lastPage = data?.pages[data.pages.length - 1]
    const total = lastPage?.total ?? 0
    const workspaceCounts = useMemo(
        () => new Map((lastPage?.workspaceCounts ?? []).map(c => [c.workspaceId, c.count])),
        [lastPage],
    )
    // 当前过滤范围的真实总数（页级「全部删除」的确认文案与按钮态依据）
    const filteredTotal = workspaceFilter === WORKSPACE_ALL
        ? total
        : workspaceCounts.get(workspaceFilter === WORKSPACE_NONE ? null : workspaceFilter) ?? 0

    const workspaceName = useMemo(() => new Map(workspaces.map(w => [w.id, w.name])), [workspaces])

    // ── Listy 虚拟滚动量高：容器 flex:1 撑满剩余空间，ResizeObserver 跟随视口变化。
    // ref 经 state 挂钩（loading 早退分支先于 ListyShell 挂载，mount 一次的 effect
    // 会拿到 null 且不再重跑——listHeight 恒 0、Listy 恒不挂载）──
    const [listShell, setListShell] = useState<HTMLDivElement | null>(null)
    // 滑移底色层要 RefObject 形态的容器引用——与量高 state 同源同步
    const shellRef = useRef<HTMLDivElement | null>(null)
    const attachShell = useCallback((el: HTMLDivElement | null) => {
        shellRef.current = el
        setListShell(el)
    }, [])
    const [listHeight, setListHeight] = useState(0)
    useEffect(() => {
        if (!listShell) return
        const update = () => setListHeight(listShell.clientHeight)
        update()
        const observer = new ResizeObserver(update)
        observer.observe(listShell)
        return () => observer.disconnect()
    }, [listShell])

    // 滑移底色层的容器：holder-inner（Listy 内部渲染的滚动容器，带 transform 独立
    // 层叠上下文）。RectHoverGlideLayer 会把 Fill portal 进它——Fill 与行同 context，
    // 插在行底色（z:0）与行内容（z:2）之间；holder-inner 随 Listy 挂载（listHeight>0
    // 后才存在），等高度就绪再查，查到后条件渲染组件（容器变更即重挂 portal）
    const [glideContainer, setGlideContainer] = useState<HTMLElement | null>(null)
    const glideRef = useRef<HTMLElement | null>(null)
    glideRef.current = glideContainer
    useEffect(() => {
        // holder-inner 随 Listy 挂载（listHeight>0 后才存在），等高度就绪再查
        if (!listShell || listHeight <= 0) return
        setGlideContainer(listShell.querySelector<HTMLElement>('.ant-listy-holder-inner'))
    }, [listShell, listHeight])

    // 取消归档：409（gate）原样透出逐项原因，其余通用错误
    const handleUnarchive = (session: Session) => {
        unarchive.mutate(session.id, {
            onError: (error) => reportBlockedError(messageApi, t, error, {
                blockedKey: 'archived.unarchiveBlocked',
                fallbackKey: 'common.error',
                fallbackVariant: 'error',
            }),
        })
    }

    // 批量操作范围 → daemon workspaceId 三态（页面级跟随当前过滤；组级即组归属）
    const scopeWorkspaceId = (scope: PendingBatchDelete['scope']): string | null | undefined => {
        if (scope.kind === 'group') return scope.workspaceId
        if (workspaceFilter === WORKSPACE_ALL) return undefined
        if (workspaceFilter === WORKSPACE_NONE) return null
        return workspaceFilter
    }

    // daemon 逐条结果 → 展示聚合（name 从已加载行取显示名，未加载行退化为 id）
    const toBatchResults = (results: Array<{ sessionId: string; ok: boolean; error?: string }>): BatchItemResult[] => {
        const nameById = new Map(sessions.map(s => [s.id, getSessionDisplayName(s)]))
        return results.map(r => ({
            sessionId: r.sessionId,
            name: nameById.get(r.sessionId) ?? r.sessionId,
            ok: r.ok,
            reason: r.error,
        }))
    }

    // 批量取消归档（组级）：可逆动作不设输入门槛，聚合报告
    const runBatchUnarchive = async (workspaceId: string | null) => {
        setBatchRunning(true)
        try {
            const response = await api.sessions.unarchiveArchivedSessions(workspaceId)
            const results = toBatchResults(response.data.results)
            await invalidateSessionViews(queryClient, results.filter(r => r.ok).map(r => r.sessionId))
            notification.info({
                key: 'archived-batch-result',
                message: t('archived.batch.resultTitle'),
                description: summarizeBatch(results, t, {
                    successKey: 'archived.batch.unarchiveSuccess',
                    failedKey: 'archived.batch.itemFailed',
                }),
                duration: 6,
            })
        } finally {
            setBatchRunning(false)
        }
    }

    // 批量删除：Modal 确认通过后执行；daemon 批量端点单条失败不回滚，聚合报告逐条原因
    const runBatchDelete = async (scope: PendingBatchDelete['scope']) => {
        setBatchRunning(true)
        try {
            const response = await api.sessions.deleteArchivedSessions(scopeWorkspaceId(scope))
            const results = toBatchResults(response.data.results)
            const okIds = results.filter(r => r.ok).map(r => r.sessionId)
            void evictSession(queryClient, okIds)
            await invalidateSessionViews(queryClient, okIds)
            const okCount = okIds.length
            if (okCount === results.length) {
                notification.success({
                    key: 'archived-batch-result',
                    message: t('archived.batch.resultTitle'),
                    description: t('archived.batch.deleteSuccess', { count: okCount }),
                    duration: 4,
                })
            } else {
                notification.warning({
                    key: 'archived-batch-result',
                    message: t('archived.batch.resultTitle'),
                    description: summarizeBatch(results, t, {
                        successKey: 'archived.batch.deleteSuccess',
                        failedKey: 'archived.batch.itemFailed',
                    }),
                    duration: 8,
                })
            }
        } finally {
            setBatchRunning(false)
            setPendingDelete(null)
        }
    }

    const openBatchDelete = (scope: PendingBatchDelete['scope']) => {
        setPendingDelete({ scope })
    }

    // Listy 分组：key 即工作区归属；title 渲染组头（真实计数 + ⋯ 菜单）
    const renderGroupHeader = useCallback((wsId: string | null): ReactNode => {
        const name = wsId ? (workspaceName.get(wsId) ?? t('archived.unknownWorkspace')) : t('archived.ungrouped')
        const count = workspaceCounts.get(wsId) ?? 0
        return (
            <GroupHeader $token={token}>
                <Folder size={15} style={{ color: token.colorTextQuaternary, flexShrink: 0 }} />
                {name}
                <GroupCount $token={token}>{t('archived.groupCount', { count })}</GroupCount>
                <GroupActions className="group-actions">
                    <DropdownMenu
                        trigger={
                            <GroupActionButton
                                $token={token}
                                aria-label={t('archived.groupActions')}
                                disabled={batchRunning}
                            >
                                <MoreHorizontal size={16} />
                            </GroupActionButton>
                        }
                        items={[
                            {
                                label: t('archived.batch.unarchiveGroup', { count }),
                                icon: <ArchiveRestore size={15} />,
                                disabled: batchRunning,
                                onSelect: () => { void runBatchUnarchive(wsId) },
                            },
                            {
                                label: t('archived.batch.deleteGroup', { count }),
                                icon: <Trash2 size={15} />,
                                destructive: true,
                                disabled: batchRunning,
                                separatorBefore: true,
                                onSelect: () => openBatchDelete(
                                    { kind: 'group', groupName: name, workspaceId: wsId, count },
                                ),
                            },
                        ]}
                    />
                </GroupActions>
            </GroupHeader>
        )
    }, [workspaceName, workspaceCounts, token, t, batchRunning, messageApi])

    const renderRow = useCallback((row: AnnotatedRow) => {
        const session = row.session
        return (
            <ArchivedRow $token={token} data-glide-row>
                {/* 行卡底色层：滑移 hover 的测量目标（几何与圆角都从它实测） */}
                <RowSurface
                    $token={token}
                    className={['archived-row-surface', row.groupFirst ? 'group-first' : '', row.groupLast ? 'group-last' : ''].join(' ').trim() || undefined}
                />
                <RowMain>
                    <RowName>{getSessionDisplayName(session)}</RowName>
                    {/* 副行双时间（icon 标注语义，同 session 列表口径）：最后活跃 + 归档；非当天自动带日期 */}
                    <RowTime $token={token}>
                        <TimeChunk title={t('archived.lastActiveAt')}>
                            <Clock size={12} />
                            {formatMessageTime(session.updatedAt)}
                        </TimeChunk>
                        <span aria-hidden="true">·</span>
                        {session.archivedAt && (
                            <TimeChunk title={t('archived.archivedAtLabel')}>
                                <ArchiveIcon size={12} />
                                {formatMessageTime(session.archivedAt)}
                            </TimeChunk>
                        )}
                    </RowTime>
                </RowMain>
                <RowActions>
                    <RowDeleteButton
                        $token={token}
                        title={t('session.actions.delete')}
                        onClick={() => confirmDelete(session)}
                    >
                        <Trash2 size={15} />
                    </RowDeleteButton>
                    <Button
                        variant="secondary"
                        size="sm"
                        disabled={unarchive.isPending && unarchive.variables === session.id}
                        onClick={() => handleUnarchive(session)}
                    >
                        {t('session.actions.unarchive')}
                    </Button>
                </RowActions>
            </ArchivedRow>
        )
    }, [token, t, confirmDelete, unarchive, messageApi])

    // 加载中先给占位：标题行（含头部锚位）恒渲染，列表区给加载占位
    if (isLoading) {
        return (
            <PageShell>
                <Inner>
                    <TitleRow $token={token}>
                        {headerLeft && <TitleAnchorSlot>{headerLeft}</TitleAnchorSlot>}
                        <PageTitle $token={token}>{t('archived.title')}</PageTitle>
                    </TitleRow>
                    <ToolBar><SearchSlot disabled placeholder={t('common.loading')} /></ToolBar>
                </Inner>
            </PageShell>
        )
    }

    if (total === 0) {
        return (
            <PageShell>
                <Inner>
                    <TitleRow $token={token}>
                        {headerLeft && <TitleAnchorSlot>{headerLeft}</TitleAnchorSlot>}
                        <PageTitle $token={token}>{t('archived.title')}</PageTitle>
                    </TitleRow>
                    <EmptyState $token={token}>
                        <ArchiveIcon size={32} />
                        <div>{t('archived.empty')}</div>
                    </EmptyState>
                </Inner>
            </PageShell>
        )
    }

    const workspaceOptions = [
        { value: WORKSPACE_ALL, label: t('archived.allWorkspaces') },
        ...workspaces.filter(w => workspaceCounts.has(w.id)).map(w => ({ value: w.id, label: w.name })),
        ...(workspaceCounts.has(null) ? [{ value: WORKSPACE_NONE, label: t('archived.ungrouped') }] : []),
    ]

    return (
        <PageShell>
            <Inner>
                {/* 标题行：左锚位 + 大标题 + 右缘全部删除（范围 = 当前过滤条件，非「已加载页」） */}
                <TitleRow $token={token}>
                    {headerLeft && <TitleAnchorSlot>{headerLeft}</TitleAnchorSlot>}
                    <PageTitle $token={token}>{t('archived.title')}</PageTitle>
                    <Button
                        className="title-delete-all"
                        variant="secondary"
                        danger
                        size="sm"
                        disabled={batchRunning || filteredTotal === 0}
                        onClick={() => openBatchDelete({ kind: 'page', count: filteredTotal })}
                    >
                        <Trash2 size={12} /> {t('archived.batch.deleteAll')}
                    </Button>
                </TitleRow>

                {/* 工具条：搜索占位（功能后续接入）+ 项目过滤 */}
                <ToolBar>
                    <SearchSlot
                        disabled
                        placeholder={t('archived.searchPlaceholder')}
                        prefix={<Search size={13} style={{ color: token.colorTextQuaternary }} />}
                        allowClear={false}
                    />
                    <WorkspaceFilter
                        value={workspaceFilter}
                        onValueChange={(v) => setWorkspaceFilter(v)}
                        options={workspaceOptions}
                        ariaLabel={t('archived.allWorkspaces')}
                    />
                </ToolBar>

                {sessions.length === 0 ? (
                    <NoMatchRow $token={token}>{t('archived.noMatch')}</NoMatchRow>
                ) : (
                    <>
                        <ListyShell ref={attachShell} $token={token}>
                            {/* 高度就绪后才挂 Listy（virtual 依赖 height；ResizeObserver 首帧即给值） */}
                            {listHeight > 0 && (
                                <>
                                    {/* 滑移 hover 底色层：底色块弹簧从上一行滑到新行（主列表同款手感）。
                                     * Fill portal 进 holder-inner（transform 层叠上下文，与行同 context 层序才正确）；
                                     * 几何/圆角都从 RowSurface 实测（组边界逐行不同的圆角随行跟随），
                                     * 滚动后行几何失效先淡出（虚拟列表约定），移动指针重新定位 */}
                                    {glideContainer && (
                                        <RectHoverGlideLayer
                                            containerRef={glideRef}
                                            measureSelector=".archived-row-surface"
                                            hideOnScroll
                                            radiusFor={(measured) => getComputedStyle(measured).borderRadius}
                                            $background={token.colorBgTextHover}
                                            $radius="0px"
                                            className="archived-glide-fill"
                                        />
                                    )}
                                    <Listy<AnnotatedRow>
                                    items={annotated}
                                    rowKey={(row) => row.session.id}
                                    virtual
                                    height={listHeight}
                                    group={{
                                        // antd Key 不含 null——未归入工作区走 '__none__' 哨兵（与过滤选项同值）
                                        key: (row) => row.session.workspaceId ?? WORKSPACE_NONE,
                                        title: (groupKey) => renderGroupHeader(groupKey === WORKSPACE_NONE ? null : String(groupKey)),
                                    }}
                                    itemRender={renderRow}
                                    classNames={{
                                        root: 'archived-listy-root',
                                        item: 'archived-listy-item',
                                        groupHeader: 'archived-listy-header',
                                    }}
                                />
                                </>
                            )}
                        </ListyShell>
                        {/* 手动分页：用户点「加载更多」拉下一页（滚动只负责浏览，不被自动预取拖着走） */}
                        {hasNextPage && (
                            <LoadMoreRow>
                                {isFetchingNextPage ? (
                                    <LoadMorePill $token={token}>
                                        <Spin size="small" />
                                        {t('archived.loadingMore')}
                                    </LoadMorePill>
                                ) : (
                                    <Button variant="secondary" size="sm" onClick={() => void fetchNextPage()}>
                                        {t('archived.loadMore')}
                                    </Button>
                                )}
                            </LoadMoreRow>
                        )}
                    </>
                )}
            </Inner>

            {/* 批量删除确认（票 08）：确认输入自持在 Modal 子组件里，键入不触发整页列表 reconcile */}
            <BatchDeleteConfirmModal
                pendingDelete={pendingDelete}
                batchRunning={batchRunning}
                onConfirm={(scope) => { void runBatchDelete(scope) }}
                onCancel={() => { if (!batchRunning) setPendingDelete(null) }}
            />
        </PageShell>
    )
}

/**
 * 批量删除确认 Modal（票 08）：展示范围真实条数 + 输入项目名 / DELETE 才可提交。
 * 自管 Modal 而非 modal.confirm——确认输入要联动 okButton disabled，受控更直接；
 * 确认输入 state 自持于此（destroyOnHidden 卸载即清空），不挂在页面根组件上。
 */
function BatchDeleteConfirmModal({ pendingDelete, batchRunning, onConfirm, onCancel }: {
    pendingDelete: PendingBatchDelete | null
    batchRunning: boolean
    onConfirm: (scope: PendingBatchDelete['scope']) => void
    onCancel: () => void
}) {
    const { token } = useToken()
    const { t } = useTranslation()
    const [confirmInput, setConfirmInput] = useState('')
    const confirmExpected = pendingDelete ? batchConfirmExpected(pendingDelete.scope) : ''
    const confirmReady = pendingDelete !== null && confirmInput.trim() === confirmExpected

    return (
        <Modal
            title={t('archived.batch.deleteConfirmTitle')}
            open={pendingDelete !== null}
            onCancel={() => { if (!batchRunning) { onCancel(); setConfirmInput('') } }}
            okText={t('archived.batch.deleteConfirmOk')}
            okButtonProps={{ danger: true, disabled: !confirmReady, loading: batchRunning }}
            cancelText={t('common.cancel')}
            onOk={() => {
                if (pendingDelete) onConfirm(pendingDelete.scope)
            }}
            destroyOnHidden
        >
            <p style={{ marginBottom: 12 }}>
                {pendingDelete && (pendingDelete.scope.kind === 'group'
                    ? t('archived.batch.deleteConfirmGroupDesc', { name: pendingDelete.scope.groupName, count: pendingDelete.scope.count })
                    : t('archived.batch.deleteConfirmPageDesc', { count: pendingDelete.scope.count }))}
            </p>
            <p style={{ marginBottom: 8, color: token.colorTextSecondary, fontSize: 12 }}>
                {pendingDelete?.scope.kind === 'group' && pendingDelete.scope.groupName.trim().length > 0
                    ? t('archived.batch.typeGroupName', { name: pendingDelete.scope.groupName.trim() })
                    : t('archived.batch.typeDelete', { token: BATCH_DELETE_CONFIRM_TOKEN })}
            </p>
            <Input
                value={confirmInput}
                onChange={e => setConfirmInput(e.target.value)}
                placeholder={confirmExpected}
                disabled={batchRunning}
                autoFocus
            />
        </Modal>
    )
}
