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
import { theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { FolderClosed, FolderOpen, Plus } from 'lucide-react'
import { useProjectSessions } from '@/core/data/hooks/queries/useProjectSessions'
import type { Project } from '@/core/data/api/types'
import {
    GroupHeader, FolderIcon, GroupName, NewSessionBtn,
    SessionListWrapper, SessionListInner, EmptyRow,
} from './mobileProjectList.styles'
import { MobileSessionItem } from './MobileSessionItem'
import { SessionSkeletonRows } from './SessionSkeletonRows'
import { SessionListFooter, getSessionListDisplayState } from './SessionListFooter'

const { useToken } = antTheme

interface MobileProjectGroupProps {
    project: Project
    activeSessionId: string | undefined
    onSessionAction: (sessionId: string) => void
    onCloseMenu: () => void
}

/** 移动端单个项目分组 */
export function MobileProjectGroup({
    project, activeSessionId, onSessionAction, onCloseMenu,
}: MobileProjectGroupProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()

    const {
        sessions, visibleSessions, fullProjectPath,
        expanded, toggleExpanded,
        isLoadingInitial, isLoadingMore,
        showCollapse, canShowMore, remainingCount,
        showMore, collapse,
    } = useProjectSessions(project.id, activeSessionId)

    // 新建会话：带上项目归属（hub 侧把 cwd 锁定项目 primary folder + 挂 projectId）
    const handleNewSession = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        onCloseMenu()
        navigate({ to: '/sessions/new', search: { cwd: fullProjectPath, projectId: project.id } })
    }, [navigate, fullProjectPath, project.id, onCloseMenu])

    const handleSessionClick = useCallback((sessionId: string) => {
        onCloseMenu()
        navigate({ to: '/sessions/$sessionId', params: { sessionId } })
    }, [navigate, onCloseMenu])

    // 展开容器在「有会话」或「正在首次加载」时撑开，避免点了没反馈
    // 展开即撑开：空分组展示「暂无会话」占位（点击有反馈），加载中展示骨架
    const wrapperExpanded = expanded
    const { showSkeleton, showEmpty, showFooter } = getSessionListDisplayState({
        isLoadingInitial, sessionCount: sessions.length, showCollapse, canShowMore, isLoadingMore,
    })

    return (
        <div>
            <GroupHeader $token={token} onClick={toggleExpanded}>
                <FolderIcon $token={token}>
                    {expanded ? <FolderOpen size={18} /> : <FolderClosed size={18} />}
                </FolderIcon>
                <GroupName $token={token}>{project.name}</GroupName>
                <NewSessionBtn $token={token} onClick={handleNewSession} aria-label={t('nav.newSession')}>
                    <Plus size={18} />
                </NewSessionBtn>
            </GroupHeader>
            <SessionListWrapper $expanded={wrapperExpanded}>
                <SessionListInner>
                    {showSkeleton ? (
                        <SessionSkeletonRows variant="mobile" rows={3} />
                    ) : showEmpty ? (
                        <EmptyRow $token={token}>{t('nav.noSessions')}</EmptyRow>
                    ) : visibleSessions.map(session => (
                        <MobileSessionItem
                            key={session.id}
                            session={session}
                            active={session.id === activeSessionId}
                            onClick={() => handleSessionClick(session.id)}
                            onLongPress={() => onSessionAction(session.id)}
                        />
                    ))}
                    {showFooter && (
                        <SessionListFooter
                            variant="mobile"
                            canShowMore={canShowMore}
                            remainingCount={remainingCount}
                            isLoadingMore={isLoadingMore}
                            showCollapse={showCollapse}
                            onShowMore={showMore}
                            onCollapse={collapse}
                        />
                    )}
                </SessionListInner>
            </SessionListWrapper>
        </div>
    )
}
