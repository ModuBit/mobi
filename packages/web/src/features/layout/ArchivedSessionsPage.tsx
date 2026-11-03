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
import type { MouseEvent as ReactMouseEvent } from 'react'
import { App, Checkbox, Input, Modal, theme as antTheme } from 'antd'
import { Archive as ArchiveIcon, ArchiveRestore } from 'lucide-react'
import { DeleteOutlined, MoreOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import { useArchivedSessions } from '@/core/data/hooks/queries/useArchivedSessions'
import { useWorkspaces } from '@/core/data/hooks/queries/useWorkspaces'
import { useSessionArchive } from '@/core/data/hooks/mutations/useSessionArchive'
import { DropdownMenu, type DropdownItem } from '@/ui/base/interactive/dropdown-menu/DropdownMenu'
import { Button } from '@/ui/base/interactive/button/Button'
import { formatRelativeTime } from '@/core/utils/timeFormat'
import { getSessionDisplayName } from '@/core/utils/sessionUtils'
import { dormancyBlockedText, extractBlockers } from '@/core/data/sessionDormancy'
import { queryKeys } from '@/core/lib/queryKeys'
import { invalidateSessionViews } from '@/core/lib/invalidateViews'
import { clearMessageWindow } from '@/core/data/stores/messageWindowStore'
import { clearSessionResources } from '@/core/lib/sessionResources'
import { useSessionDelete } from './useSessionDelete'
import { runBatch, summarizeBatch, batchConfirmExpected } from './archivedBatch'
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
    gap: 4px;
`

/* 批量工具行：无选中时右侧是页面级「全部删除」，有选中时整条切换为选择动作条 */
const BatchBar = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px 8px;
`

const BatchBarInfo = styled.span<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    flex: 1;
    font-size: 12px;
    color: ${p => p.$token.colorTextSecondary};
`

const GroupLabel = styled.div<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 500;
    color: ${p => p.$token.colorTextQuaternary};
    padding: 12px 8px 6px;
    user-select: none;

    /* 组级批量动作：hover 显示 */
    .group-actions {
        visibility: hidden;
    }
    &:hover .group-actions {
        visibility: visible;
    }
`

const GroupActions = styled.span`
    display: inline-flex;
    align-items: center;
    gap: 2px;
`

const GroupActionButton = styled.button<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 20px;
    padding: 0 6px;
    border: none;
    background: transparent;
    color: ${p => p.$token.colorTextTertiary};
    border-radius: var(--radius-icon);
    cursor: pointer;
    font-size: 11px;
    transition: color 0.15s, background 0.15s;

    &:hover {
        color: ${p => p.$token.colorText};
        background: ${p => p.$token.colorBgTextHover};
    }
`

const ArchivedRow = styled.div<{ $token: ReturnType<typeof antTheme.useToken>['token']; $selected?: boolean }>`
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 34px;
    padding: 0 8px;
    border-radius: var(--radius-control);
    font-size: 12.5px;
    color: ${p => p.$token.colorText};
    background: ${p => p.$selected ? p.$token.colorPrimaryBg : 'transparent'};

    &:hover {
        background: ${p => p.$selected ? p.$token.colorPrimaryBg : p.$token.colorBgTextHover};

        /* hover 时隐藏归档时间、显出菜单锚点（与主列表行同语义） */
        .archived-time {
            display: none;
        }
    }
`

const RowCheckbox = styled(Checkbox)`
    flex-shrink: 0;
    font-size: 13px;
`

const RowName = styled.span`
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

const RowTime = styled.span<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    flex-shrink: 0;
    font-size: 11px;
    color: ${p => p.$token.colorTextQuaternary};
    white-space: nowrap;
`

const RowActions = styled.span`
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
`

const RowMenuButton = styled.button<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
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

/**
 * 归档页本体（票 05 + 票 08）：按工作区分组列出归档会话（标题 + 归档时间；归属由组头承载），
 * 行内取消归档 / 删除、行首多选、组级与页面级批量操作（删除须输入项目名或 DELETE 确认，
 * 逐条执行、部分失败不回滚整批并逐条报告）。不做搜索（票 05 明确）。
 * 组装壳（头部 / 返回键）在 pages/ArchivedPage，本组件只管列表呈现。
 */
export function ArchivedSessionsPage() {
    const { token } = useToken()
    const { t } = useTranslation()
    const { message: messageApi, notification } = App.useApp()
    const api = useMobiApi()
    const queryClient = useQueryClient()
    const { data: archived = [], isLoading } = useArchivedSessions()
    const { data: workspaces = [] } = useWorkspaces()
    const { unarchive } = useSessionArchive()
    const confirmDelete = useSessionDelete()

    // ── 多选（票 08）──
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    // ── 批量删除确认（自管 Modal：antd modal.confirm 的受控 Input 联动 fragile）──
    const [pendingDelete, setPendingDelete] = useState<PendingBatchDelete | null>(null)
    const [confirmInput, setConfirmInput] = useState('')
    const [batchRunning, setBatchRunning] = useState(false)

    const groups = useMemo<ArchivedGroup[]>(() => {
        const workspaceName = new Map(workspaces.map(w => [w.id, w.name]))
        const byWorkspace = new Map<string | null, Session[]>()
        for (const session of archived) {
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
    }, [archived, workspaces, t])

    const toggleSelect = (sessionId: string) => {
        setSelectedIds(old => {
            const next = new Set(old)
            if (next.has(sessionId)) next.delete(sessionId)
            else next.add(sessionId)
            return next
        })
    }

    const selectedSessions = useMemo(
        () => archived.filter(s => selectedIds.has(s.id)),
        [archived, selectedIds],
    )

    /** 批量动作成功条目的缓存清理（与单条删除流一致） */
    const cleanupAfterBatch = (sessionIds: string[]) => {
        for (const id of sessionIds) {
            queryClient.removeQueries({ queryKey: queryKeys.session(id) })
            clearMessageWindow(id)
            clearSessionResources(id)
        }
        void invalidateSessionViews(queryClient, sessionIds)
    }

    // 取消归档：409（gate）原样透出逐项原因，其余通用错误
    const handleUnarchive = (session: Session) => {
        unarchive.mutate(session.id, {
            onError: (error) => {
                const blockers = extractBlockers(error)
                messageApi.error(blockers.length > 0
                    ? dormancyBlockedText(blockers, t, 'archived.unarchiveBlocked')
                    : t('common.error'))
            },
        })
    }

    // 批量取消归档（选中项 / 组级）：可逆动作不设输入门槛，聚合报告
    const runBatchUnarchive = async (sessions: Session[]) => {
        setBatchRunning(true)
        try {
            const results = await runBatch(sessions, id => api.sessions.unarchive(id))
            await invalidateSessionViews(queryClient, results.filter(r => r.ok).map(r => r.sessionId))
            setSelectedIds(new Set())
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
            cleanupAfterBatch(okIds)
            setSelectedIds(new Set())
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
            setConfirmInput('')
        }
    }

    const openBatchDelete = (scope: PendingBatchDelete['scope'], sessions: Session[]) => {
        setConfirmInput('')
        setPendingDelete({ scope, sessions })
    }

    const confirmExpected = pendingDelete ? batchConfirmExpected(pendingDelete.scope) : ''
    const confirmReady = pendingDelete !== null && confirmInput.trim() === confirmExpected

    const renderMenuItems = (session: Session): DropdownItem[] => [
        {
            key: 'unarchive',
            icon: <ArchiveRestore size={11} />,
            label: t('session.actions.unarchive'),
            disabled: unarchive.isPending && unarchive.variables === session.id,
            onSelect: () => handleUnarchive(session),
        },
        {
            key: 'delete',
            icon: <DeleteOutlined />,
            label: t('session.actions.delete'),
            destructive: true,
            onSelect: () => confirmDelete(session),
        },
    ]

    if (!isLoading && archived.length === 0) {
        return (
            <EmptyState $token={token}>
                <ArchiveIcon size={32} />
                <div>{t('archived.empty')}</div>
            </EmptyState>
        )
    }

    return (
        <PageScroll $token={token}>
            <Inner>
                {/* 批量工具行：选中动作条 / 页面级全部删除（票 08：范围严格限当前列表） */}
                <BatchBar>
                    {selectedSessions.length > 0 ? (
                        <>
                            <BatchBarInfo $token={token}>{t('archived.batch.selected', { count: selectedSessions.length })}</BatchBarInfo>
                            <Button variant="secondary" size="sm" disabled={batchRunning} onClick={() => { void runBatchUnarchive(selectedSessions) }}>
                                <ArchiveRestore size={12} /> {t('session.actions.unarchive')}
                            </Button>
                            <Button variant="secondary" danger size="sm" disabled={batchRunning} onClick={() => openBatchDelete({ kind: 'page' }, selectedSessions)}>
                                <DeleteOutlined style={{ fontSize: 12 }} /> {t('session.actions.delete')}
                            </Button>
                            <Button variant="ghost" size="sm" disabled={batchRunning} onClick={() => setSelectedIds(new Set())}>
                                {t('archived.batch.clearSelection')}
                            </Button>
                        </>
                    ) : (
                        <>
                            <BatchBarInfo $token={token} />
                            <Button
                                variant="secondary"
                                danger
                                size="sm"
                                disabled={batchRunning}
                                onClick={() => openBatchDelete({ kind: 'page' }, archived)}
                            >
                                <DeleteOutlined style={{ fontSize: 12 }} /> {t('archived.batch.deleteAll', { count: archived.length })}
                            </Button>
                        </>
                    )}
                </BatchBar>

                {groups.map(group => (
                    <div key={group.workspaceId ?? '__ungrouped'}>
                        <GroupLabel $token={token}>
                            {group.workspaceName}
                            <GroupActions className="group-actions">
                                <GroupActionButton
                                    $token={token}
                                    disabled={batchRunning}
                                    onClick={() => { void runBatchUnarchive(group.sessions) }}
                                >
                                    <ArchiveRestore size={11} /> {t('archived.batch.unarchiveGroup', { count: group.sessions.length })}
                                </GroupActionButton>
                                <GroupActionButton
                                    $token={token}
                                    disabled={batchRunning}
                                    onClick={() => openBatchDelete(
                                        group.workspaceId
                                            ? { kind: 'group', groupName: group.workspaceName }
                                            : { kind: 'page' },
                                        group.sessions,
                                    )}
                                >
                                    <DeleteOutlined style={{ fontSize: 11 }} /> {t('archived.batch.deleteGroup', { count: group.sessions.length })}
                                </GroupActionButton>
                            </GroupActions>
                        </GroupLabel>
                        {group.sessions.map(session => (
                            <ArchivedRow key={session.id} $token={token} $selected={selectedIds.has(session.id) || undefined}>
                                <RowCheckbox
                                    checked={selectedIds.has(session.id)}
                                    onChange={() => toggleSelect(session.id)}
                                    onClick={(e: ReactMouseEvent) => e.stopPropagation()}
                                    aria-label={t('archived.batch.selectRow', { name: getSessionDisplayName(session) })}
                                />
                                <RowName>{getSessionDisplayName(session)}</RowName>
                                <RowTime $token={token} className="archived-time">
                                    {session.archivedAt ? t('archived.archivedAt', { time: formatRelativeTime(session.archivedAt, t) }) : ''}
                                </RowTime>
                                <RowActions>
                                    <DropdownMenu
                                        trigger={
                                            <RowMenuButton $token={token} title={t('common.more')} onClick={e => e.stopPropagation()}>
                                                <MoreOutlined style={{ fontSize: 12 }} />
                                            </RowMenuButton>
                                        }
                                        items={renderMenuItems(session)}
                                    />
                                </RowActions>
                            </ArchivedRow>
                        ))}
                    </div>
                ))}
            </Inner>

            {/* 批量删除确认（票 08）：展示条数 + 输入项目名 / DELETE 才可提交。
                自管 Modal 而非 modal.confirm——确认输入要联动 okButton disabled，受控更直接 */}
            <Modal
                title={t('archived.batch.deleteConfirmTitle')}
                open={pendingDelete !== null}
                onCancel={() => { if (!batchRunning) { setPendingDelete(null); setConfirmInput('') } }}
                okText={t('archived.batch.deleteConfirmOk')}
                okButtonProps={{ danger: true, disabled: !confirmReady, loading: batchRunning }}
                cancelText={t('common.cancel')}
                onOk={() => {
                    if (pendingDelete) void runBatchDelete(pendingDelete.sessions)
                }}
                destroyOnHidden
            >
                <p style={{ marginBottom: 12 }}>
                    {pendingDelete?.scope.kind === 'group'
                        ? t('archived.batch.deleteConfirmGroupDesc', { name: pendingDelete.scope.groupName, count: pendingDelete.sessions.length })
                        : pendingDelete
                            ? t('archived.batch.deleteConfirmPageDesc', { count: pendingDelete.sessions.length })
                            : ''}
                </p>
                <p style={{ marginBottom: 8, color: token.colorTextSecondary, fontSize: 12 }}>
                    {pendingDelete?.scope.kind === 'group' && pendingDelete.scope.groupName.trim().length > 0
                        ? t('archived.batch.typeGroupName', { name: pendingDelete.scope.groupName.trim() })
                        : t('archived.batch.typeDelete')}
                </p>
                <Input
                    value={confirmInput}
                    onChange={e => setConfirmInput(e.target.value)}
                    placeholder={confirmExpected}
                    disabled={batchRunning}
                    autoFocus
                />
            </Modal>
        </PageScroll>
    )
}
