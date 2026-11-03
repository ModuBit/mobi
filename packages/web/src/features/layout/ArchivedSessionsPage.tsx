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

import { useMemo } from 'react'
import { App, theme as antTheme } from 'antd'
import { Archive as ArchiveIcon, ArchiveRestore } from 'lucide-react'
import { DeleteOutlined, MoreOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import { useArchivedSessions } from '@/core/data/hooks/queries/useArchivedSessions'
import { useWorkspaces } from '@/core/data/hooks/queries/useWorkspaces'
import { useSessionArchive } from '@/core/data/hooks/mutations/useSessionArchive'
import { DropdownMenu, type DropdownItem } from '@/ui/base/interactive/dropdown-menu/DropdownMenu'
import { formatRelativeTime } from '@/core/utils/timeFormat'
import { getSessionDisplayName } from '@/core/utils/sessionUtils'
import { dormancyBlockedText, extractBlockers } from '@/core/data/sessionDormancy'
import { useSessionDelete } from './useSessionDelete'
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

const GroupLabel = styled.div<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    font-size: 12px;
    font-weight: 500;
    color: ${p => p.$token.colorTextQuaternary};
    padding: 12px 8px 6px;
    user-select: none;
`

const ArchivedRow = styled.div<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 34px;
    padding: 0 8px;
    border-radius: var(--radius-control);
    font-size: 12.5px;
    color: ${p => p.$token.colorText};

    &:hover {
        background: ${p => p.$token.colorBgTextHover};

        /* hover 时隐藏归档时间、显出菜单锚点（与主列表行同语义） */
        .archived-time {
            display: none;
        }
    }
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

/**
 * 归档页本体（票 05）：按工作区分组列出归档会话（标题 + 归档时间；归属由组头承载），
 * 行内取消归档 / 删除；无归档时空状态。不做搜索（票 05 明确）。
 * 组装壳（头部 / 返回键）在 pages/ArchivedPage，本组件只管列表呈现。
 */
export function ArchivedSessionsPage() {
    const { token } = useToken()
    const { t } = useTranslation()
    const { message: messageApi } = App.useApp()
    const { data: archived = [], isLoading } = useArchivedSessions()
    const { data: workspaces = [] } = useWorkspaces()
    const { unarchive } = useSessionArchive()
    const confirmDelete = useSessionDelete()

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
                {groups.map(group => (
                    <div key={group.workspaceId ?? '__ungrouped'}>
                        <GroupLabel $token={token}>{group.workspaceName}</GroupLabel>
                        {group.sessions.map(session => (
                            <ArchivedRow key={session.id} $token={token}>
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
        </PageScroll>
    )
}
