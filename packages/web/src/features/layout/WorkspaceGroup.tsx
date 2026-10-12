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

import type React from 'react'
import { useCallback } from 'react'
import { Dropdown, theme as antTheme } from 'antd'
import type { MenuProps } from 'antd'
import { EditOutlined, DeleteOutlined, MoreOutlined, ImportOutlined, SwapOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { FolderClosed, FolderOpen, Plus } from 'lucide-react'
import { useWorkspaceSessions } from '@/core/data/hooks/queries/useWorkspaceSessions'
import type { Session, Workspace } from '@/core/data/api/types'
import {
    GroupContainer, GroupHeader, HeaderActionButton, FolderIcon, GroupName,
    SessionListWrapper, SessionListInner,
} from './sidebarWorkspaces.styles'
import { SessionRowsList } from './SessionRowsList'
import type { SessionListSharedProps } from './SessionRowsList'
import { useSessionRowNavigate } from './useSessionRowNavigate'

const { useToken } = antTheme

interface WorkspaceGroupProps extends SessionListSharedProps {
    workspace: Workspace
    /** 编辑工作区（标题 hover 菜单） */
    onEditWorkspace: (workspace: Workspace) => void
    /** 删除工作区（标题 hover 菜单，需 total 拼确认文案；total 未就绪时传 undefined） */
    onDeleteWorkspace: (workspace: Workspace, total: number | undefined) => void
    /** 移至最近（assignSession(id, null)） */
    onMoveToRecent: (session: Session) => void
    /** 换工作区（打开 AssignWorkspaceModal） */
    onChangeWorkspace: (session: Session) => void
    /** 正在变更归属的会话 id（仅该行禁用追加操作，其余行不受牵连） */
    assignPendingSessionId: string | undefined
}

/**
 * 单个工作区分组
 * 自动展开包含当前活跃会话的分组，其余折叠
 */
export function WorkspaceGroup({
    workspace, activeSessionId,
    onEditWorkspace, onDeleteWorkspace, onMoveToRecent, onChangeWorkspace, assignPendingSessionId,
    ...shared
}: WorkspaceGroupProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const handleSessionClick = useSessionRowNavigate()

    const {
        sessions, visibleSessions, total,
        expanded, toggleExpanded,
        isLoadingInitial, isLoadingMore,
        showCollapse, canShowMore, remainingCount,
        showMore, collapse,
    } = useWorkspaceSessions(workspace.id, activeSessionId)

    // 新建会话：带上工作区归属（daemon 侧把 cwd 锁定工作区 primary folder + 挂 workspaceId）
    const handleNewSession = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        navigate({ to: '/sessions/new', search: { workspaceId: workspace.id } })
    }, [navigate, workspace.id])

    // 标题 hover 菜单：编辑 / 删除工作区
    const headerMenu: MenuProps = {
        items: [
            { key: 'edit', icon: <EditOutlined />, label: t('workspace.edit') },
            { key: 'delete', icon: <DeleteOutlined />, danger: true, label: t('workspace.delete') },
        ],
        onClick: ({ key, domEvent }) => {
            domEvent.stopPropagation()
            if (key === 'edit') onEditWorkspace(workspace)
            if (key === 'delete') onDeleteWorkspace(workspace, total)
        },
    }

    // dropdown 附加项：移至最近 / 换工作区（pending 时整组禁用——两项是互斥的分组变更，
    // 只禁其一仍可并发触发另一项）
    const renderExtraMenuItems = useCallback((session: Session): MenuProps['items'] => ([
        {
            key: 'recent',
            icon: <ImportOutlined />,
            label: t('workspace.toRecent'),
            disabled: session.id === assignPendingSessionId,
        },
        {
            key: 'change',
            icon: <SwapOutlined />,
            label: t('workspace.changeWorkspace'),
            disabled: session.id === assignPendingSessionId,
        },
    ]), [t, assignPendingSessionId])
    const handleExtraMenuClick = useCallback((session: Session, key: string) => {
        if (key === 'recent') onMoveToRecent(session)
        if (key === 'change') onChangeWorkspace(session)
    }, [onMoveToRecent, onChangeWorkspace])

    // 展开容器在「有会话」或「正在首次加载」时撑开，避免点了没反馈
    // 展开即撑开：空分组展示「暂无会话」占位（点击有反馈），加载中展示骨架
    const wrapperExpanded = expanded

    return (
        <GroupContainer>
            <GroupHeader $token={token} onClick={toggleExpanded}>
                <FolderIcon $token={token}>
                    {expanded ? <FolderOpen size={14} /> : <FolderClosed size={14} />}
                </FolderIcon>
                <GroupName>{workspace.name}</GroupName>
                <span className="header-actions" style={{ display: 'inline-flex', gap: 2 }}>
                    <HeaderActionButton $token={token} className="new-session-btn" onClick={handleNewSession}>
                        <Plus size={13} />
                    </HeaderActionButton>
                    <Dropdown menu={headerMenu} trigger={['click']}>
                        <HeaderActionButton
                            $token={token}
                            title={t('common.more')}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <MoreOutlined style={{ fontSize: 12 }} />
                        </HeaderActionButton>
                    </Dropdown>
                </span>
            </GroupHeader>
            <SessionListWrapper $expanded={wrapperExpanded}>
                <SessionListInner>
                    <SessionRowsList
                        {...shared}
                        activeSessionId={activeSessionId}
                        sessions={sessions}
                        visibleSessions={visibleSessions}
                        isLoadingInitial={isLoadingInitial}
                        isLoadingMore={isLoadingMore}
                        showCollapse={showCollapse}
                        canShowMore={canShowMore}
                        remainingCount={remainingCount}
                        showMore={showMore}
                        collapse={collapse}
                        onSessionClick={handleSessionClick}
                        renderExtraMenuItems={renderExtraMenuItems}
                        onExtraMenuClick={handleExtraMenuClick}
                    />
                </SessionListInner>
            </SessionListWrapper>
        </GroupContainer>
    )
}
