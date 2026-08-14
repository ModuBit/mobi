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
import { FolderClosed, FolderOpen, SquarePen } from 'lucide-react'
import { useProjectSessions } from '@/core/data/hooks/queries/useProjectSessions'
import type { Session, Project } from '@/core/data/api/types'
import {
    GroupContainer, GroupHeader, HeaderActionButton, FolderIcon, GroupName,
    SessionListWrapper, SessionListInner, ActionButton,
} from './sidebarProjects.styles'
import { SessionRowsList } from './SessionRowsList'
import type { SessionListSharedProps } from './SessionRowsList'
import { useSessionRowNavigate } from './useSessionRowNavigate'

const { useToken } = antTheme

interface ProjectGroupProps extends SessionListSharedProps {
    project: Project
    /** 编辑项目（标题 hover 菜单） */
    onEditProject: (project: Project) => void
    /** 删除项目（标题 hover 菜单，需 total 拼确认文案；total 未就绪时传 undefined） */
    onDeleteProject: (project: Project, total: number | undefined) => void
    /** 移至最近（assignSession(id, null)） */
    onMoveToRecent: (session: Session) => void
    /** 换项目（打开 AssignProjectModal） */
    onChangeProject: (session: Session) => void
    /** 正在变更归属的会话 id（仅该行禁用追加操作，其余行不受牵连） */
    assignPendingSessionId: string | undefined
}

/**
 * 单个项目分组
 * 自动展开包含当前活跃会话的分组，其余折叠
 */
export function ProjectGroup({
    project, activeSessionId,
    onEditProject, onDeleteProject, onMoveToRecent, onChangeProject, assignPendingSessionId,
    ...shared
}: ProjectGroupProps) {
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
    } = useProjectSessions(project.id, activeSessionId)

    // 新建会话：带上项目归属（hub 侧把 cwd 锁定项目 primary folder + 挂 projectId）
    const handleNewSession = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        navigate({ to: '/sessions/new', search: { projectId: project.id } })
    }, [navigate, project.id])

    // 标题 hover 菜单：编辑 / 删除项目
    const headerMenu: MenuProps = {
        items: [
            { key: 'edit', icon: <EditOutlined />, label: t('project.edit') },
            { key: 'delete', icon: <DeleteOutlined />, danger: true, label: t('project.delete') },
        ],
        onClick: ({ key, domEvent }) => {
            domEvent.stopPropagation()
            if (key === 'edit') onEditProject(project)
            if (key === 'delete') onDeleteProject(project, total)
        },
    }

    // 行内追加操作：移至最近 / 换项目
    const renderExtraAction = useCallback((session: Session) => (
        <Dropdown
            menu={{
                items: [
                    { key: 'recent', icon: <ImportOutlined />, label: t('project.toRecent') },
                    { key: 'change', icon: <SwapOutlined />, label: t('project.changeProject') },
                ],
                onClick: ({ key, domEvent }: Parameters<NonNullable<MenuProps['onClick']>>[0]) => {
                    domEvent.stopPropagation()
                    if (key === 'recent') onMoveToRecent(session)
                    if (key === 'change') onChangeProject(session)
                },
            }}
            trigger={['click']}
        >
            <ActionButton
                $token={token}
                title={t('common.more')}
                disabled={session.id === assignPendingSessionId}
                onClick={(e) => e.stopPropagation()}
            >
                <MoreOutlined style={{ fontSize: 11 }} />
            </ActionButton>
        </Dropdown>
    ), [t, token, onMoveToRecent, onChangeProject, assignPendingSessionId])

    // 展开容器在「有会话」或「正在首次加载」时撑开，避免点了没反馈
    // 展开即撑开：空分组展示「暂无会话」占位（点击有反馈），加载中展示骨架
    const wrapperExpanded = expanded

    return (
        <GroupContainer>
            <GroupHeader $token={token} onClick={toggleExpanded}>
                <FolderIcon $token={token}>
                    {expanded ? <FolderOpen size={14} /> : <FolderClosed size={14} />}
                </FolderIcon>
                <GroupName>{project.name}</GroupName>
                <span className="header-actions" style={{ display: 'inline-flex', gap: 2 }}>
                    <HeaderActionButton $token={token} className="new-session-btn" onClick={handleNewSession}>
                        <SquarePen size={13} />
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
                        renderExtraAction={renderExtraAction}
                    />
                </SessionListInner>
            </SessionListWrapper>
        </GroupContainer>
    )
}
