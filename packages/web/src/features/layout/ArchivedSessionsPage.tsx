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

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { App, Input, Modal, theme as antTheme } from 'antd'
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
import { runBatch, summarizeBatch, batchConfirmExpected, BATCH_DELETE_CONFIRM_TOKEN } from './archivedBatch'
import { useMobiApi } from '@/core/data/api/client'
import { useQueryClient } from '@tanstack/react-query'
import type { Session } from '@/core/data/api/types'

const { useToken } = antTheme

const PageScroll = styled.div<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 20px max(24px, env(safe-area-inset-bottom));
`

const Inner = styled.div`
    max-width: 860px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
`

/** 空态变体：撑满视口高让 EmptyState 垂直居中 */
const InnerFill = styled(Inner)`
    min-height: 100%;
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
`

const SearchSlot = styled(Input)`
    flex: 1;
    min-width: 0;
`

const WorkspaceFilter = styled(Select)`
    width: 160px;
    flex-shrink: 0;
`

/* 组块：组头裸排在页面背景上（色块外，ChatGPT 形态），色块卡只包行列表 */
const GroupBlock = styled.div<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    & + & {
        margin-top: 28px;
    }
`

const GroupCard = styled.div<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    border: 1px solid ${p => p.$token.colorBorderSecondary};
    border-radius: var(--radius-panel);
    background: ${p => p.$token.colorBgContainer};
    overflow: hidden;
`

const GroupHeader = styled.div<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 4px 12px;
    font-size: 14px;
    font-weight: 600;
    color: ${p => p.$token.colorText};
    user-select: none;

    /* 组级动作「⋯」：hover 显示（触屏无 hover 常驻），下拉面板打开期间不隐藏 */
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

const ArchivedRow = styled.div<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    color: ${p => p.$token.colorText};

    /* 行间 hairline（首行不画，紧贴卡顶） */
    & + & {
        border-top: 1px solid ${p => p.$token.colorBorderSecondary};
    }

    &:hover {
        background: ${p => p.$token.colorBgTextHover};
    }
`

/** 名称主行 + 归档时间副行（时间是名称的补充信息，窄屏不再挤压名称） */
const RowMain = styled.div`
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

/** 分组视图：工作区名 → 组内归档会话（归档时间倒序，daemon 已排序，分组保序） */
interface ArchivedGroup {
    workspaceId: string | null
    workspaceName: string
    sessions: Session[]
}

/** 待确认的批量删除：组级（输入项目名）或页面级（输入 DELETE） */
interface PendingBatchDelete {
    scope: { kind: 'group'; groupName: string } | { kind: 'page' }
    sessions: Session[]
}

const WORKSPACE_ALL = '__all__'

interface ArchivedSessionsPageProps {
    /** 头部锚位（PC 侧栏开关 / 移动端汉堡），渲染进标题行左缘——本页无独立头部横条 */
    headerLeft?: ReactNode
}

/**
 * 归档页本体（票 05/08，PC 形态一比一对齐 ChatGPT 归档页）：标题行左锚位 + 大标题
 * 左对齐（移动端字号对齐设置页头部）+ 右缘「全部删除」同基线，单行承载、无独立头部
 * 横条；工具条（搜索占位 + 项目过滤）；归档会话按项目分组——组头「项目名 + 计数 +
 * ⋯ 菜单（批量取消归档/删除）」裸排在页面背景上（色块外），色块卡只包行列表，
 * 行「名称 + 归档时间副行 + 常驻取消归档/删除动作」。
 * 删除（单条/组级/页面级）保留输入确认与逐条报告。
 * 组装壳（页面容器）在 pages/ArchivedPage，本组件只管列表呈现。
 */
export function ArchivedSessionsPage({ headerLeft }: ArchivedSessionsPageProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const { message: messageApi, notification } = App.useApp()
    const api = useMobiApi()
    const queryClient = useQueryClient()
    const { data: archived = [], isLoading } = useArchivedSessions()
    const { data: workspaces = [] } = useWorkspaces()
    const { unarchive } = useSessionArchive()
    const confirmDelete = useSessionDelete()

    // ── 过滤（搜索占位待接入，先只有项目维度）──
    const [workspaceFilter, setWorkspaceFilter] = useState<string>(WORKSPACE_ALL)
    // ── 批量删除确认（自管 Modal：antd modal.confirm 的受控 Input 联动 fragile）──
    const [pendingDelete, setPendingDelete] = useState<PendingBatchDelete | null>(null)
    const [batchRunning, setBatchRunning] = useState(false)

    const filtered = useMemo(() => {
        if (workspaceFilter === WORKSPACE_ALL) return archived
        return archived.filter(s => (s.workspaceId ?? null) === (workspaceFilter === '__none__' ? null : workspaceFilter))
    }, [archived, workspaceFilter])

    const groups = useMemo<ArchivedGroup[]>(() => {
        const workspaceName = new Map(workspaces.map(w => [w.id, w.name]))
        const byWorkspace = new Map<string | null, Session[]>()
        for (const session of filtered) {
            const key = session.workspaceId ?? null
            const bucket = byWorkspace.get(key)
            if (bucket) bucket.push(session)
            else byWorkspace.set(key, [session])
        }
        return Array.from(byWorkspace.entries()).map(([workspaceId, sessions]) => ({
            workspaceId,
            workspaceName: workspaceId ? (workspaceName.get(workspaceId) ?? t('archived.unknownWorkspace')) : t('archived.ungrouped'),
            sessions,
        }))
    }, [filtered, workspaces, t])

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

    // 批量取消归档（组级）：可逆动作不设输入门槛，聚合报告
    const runBatchUnarchive = async (sessions: Session[]) => {
        setBatchRunning(true)
        try {
            const results = await runBatch(sessions, id => api.sessions.unarchive(id))
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

    // 批量删除：Modal 确认通过后执行；单条失败不回滚，聚合报告逐条原因
    const runBatchDelete = async (sessions: Session[]) => {
        setBatchRunning(true)
        try {
            const okIds: string[] = []
            const results = await runBatch(sessions, id => api.sessions.delete(id), id => okIds.push(id))
            void evictSession(queryClient, okIds)
            const okCount = results.filter(r => r.ok).length
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

    const openBatchDelete = (scope: PendingBatchDelete['scope'], sessions: Session[]) => {
        setPendingDelete({ scope, sessions })
    }

    // 加载中先给占位：标题行（含头部锚位）恒渲染，列表区给加载占位
    if (isLoading) {
        return (
            <PageScroll $token={token}>
                <Inner>
                    <TitleRow $token={token}>
                        {headerLeft && <TitleAnchorSlot>{headerLeft}</TitleAnchorSlot>}
                        <PageTitle $token={token}>{t('archived.title')}</PageTitle>
                    </TitleRow>
                    <ToolBar><SearchSlot disabled placeholder={t('common.loading')} /></ToolBar>
                </Inner>
            </PageScroll>
        )
    }

    if (archived.length === 0) {
        return (
            <PageScroll $token={token}>
                <InnerFill>
                    <TitleRow $token={token}>
                        {headerLeft && <TitleAnchorSlot>{headerLeft}</TitleAnchorSlot>}
                        <PageTitle $token={token}>{t('archived.title')}</PageTitle>
                    </TitleRow>
                    <EmptyState $token={token}>
                        <ArchiveIcon size={32} />
                        <div>{t('archived.empty')}</div>
                    </EmptyState>
                </InnerFill>
            </PageScroll>
        )
    }

    const workspaceOptions = [
        { value: WORKSPACE_ALL, label: t('archived.allWorkspaces') },
        ...workspaces.map(w => ({ value: w.id, label: w.name })),
        ...(groups.some(g => g.workspaceId === null) || filtered.some(s => !s.workspaceId)
            ? [{ value: '__none__', label: t('archived.ungrouped') }]
            : []),
    ]

    return (
        <PageScroll $token={token}>
            <Inner>
                {/* 标题行：左锚位 + 大标题 + 右缘全部删除（「所见即所删」：范围限当前过滤结果） */}
                <TitleRow $token={token}>
                    {headerLeft && <TitleAnchorSlot>{headerLeft}</TitleAnchorSlot>}
                    <PageTitle $token={token}>{t('archived.title')}</PageTitle>
                    <Button
                        className="title-delete-all"
                        variant="secondary"
                        danger
                        size="sm"
                        disabled={batchRunning || filtered.length === 0}
                        onClick={() => openBatchDelete({ kind: 'page' }, filtered)}
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

                {groups.length === 0 ? (
                    <NoMatchRow $token={token}>{t('archived.noMatch')}</NoMatchRow>
                ) : groups.map(group => (
                    <GroupBlock key={group.workspaceId ?? '__ungrouped'} $token={token}>
                        <GroupHeader $token={token}>
                            <Folder size={15} style={{ color: token.colorTextQuaternary, flexShrink: 0 }} />
                            {group.workspaceName}
                            <GroupCount $token={token}>{t('archived.groupCount', { count: group.sessions.length })}</GroupCount>
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
                                            label: t('archived.batch.unarchiveGroup', { count: group.sessions.length }),
                                            icon: <ArchiveRestore size={15} />,
                                            disabled: batchRunning,
                                            onSelect: () => { void runBatchUnarchive(group.sessions) },
                                        },
                                        {
                                            label: t('archived.batch.deleteGroup', { count: group.sessions.length }),
                                            icon: <Trash2 size={15} />,
                                            destructive: true,
                                            disabled: batchRunning,
                                            separatorBefore: true,
                                            onSelect: () => openBatchDelete(
                                                group.workspaceId
                                                    ? { kind: 'group', groupName: group.workspaceName }
                                                    : { kind: 'page' },
                                                group.sessions,
                                            ),
                                        },
                                    ]}
                                />
                            </GroupActions>
                        </GroupHeader>
                        <GroupCard $token={token}>
                            {group.sessions.map(session => (
                                <ArchivedRow key={session.id} $token={token}>
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
                            ))}
                        </GroupCard>
                    </GroupBlock>
                ))}
            </Inner>

            {/* 批量删除确认（票 08）：确认输入自持在 Modal 子组件里，键入不触发整页列表 reconcile */}
            <BatchDeleteConfirmModal
                pendingDelete={pendingDelete}
                batchRunning={batchRunning}
                onConfirm={(sessions) => { void runBatchDelete(sessions) }}
                onCancel={() => { if (!batchRunning) setPendingDelete(null) }}
            />
        </PageScroll>
    )
}

/**
 * 批量删除确认 Modal（票 08）：展示条数 + 输入项目名 / DELETE 才可提交。
 * 自管 Modal 而非 modal.confirm——确认输入要联动 okButton disabled，受控更直接；
 * 确认输入 state 自持于此（destroyOnHidden 卸载即清空），不挂在页面根组件上。
 */
function BatchDeleteConfirmModal({ pendingDelete, batchRunning, onConfirm, onCancel }: {
    pendingDelete: PendingBatchDelete | null
    batchRunning: boolean
    onConfirm: (sessions: Session[]) => void
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
                if (pendingDelete) onConfirm(pendingDelete.sessions)
            }}
            destroyOnHidden
        >
            <p style={{ marginBottom: 12 }}>
                {pendingDelete && (pendingDelete.scope.kind === 'group'
                    ? t('archived.batch.deleteConfirmGroupDesc', { name: pendingDelete.scope.groupName, count: pendingDelete.sessions.length })
                    : t('archived.batch.deleteConfirmPageDesc', { count: pendingDelete.sessions.length }))}
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
