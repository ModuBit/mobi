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
import { FolderAddOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { ChevronRight, SquarePen } from 'lucide-react'
import { useRecentSessions } from '@/core/data/hooks/queries/useRecentSessions'
import type { Session } from '@/core/data/api/types'
import {
    GroupContainer, SectionTitleRow, SectionTitle, SectionChevron, SectionActionButton,
    SessionListWrapper, SessionListInner, ActionButton,
} from './sidebarProjects.styles'
import { SessionRowsList } from './SessionRowsList'
import type { SessionListSharedProps } from './SessionRowsList'
import { useSessionRowNavigate } from './useSessionRowNavigate'

const { useToken } = antTheme

interface RecentGroupProps extends SessionListSharedProps {
    /** 归入项目（打开 AssignProjectModal） */
    onAssign: (session: Session) => void
    /** 正在归入项目的会话 id（仅该行禁用入口，其余行不受牵连） */
    assignPendingSessionId: string | undefined
}

/**
 * 「最近」分区：游离（未归入项目）会话，与「项目」分区平级。
 * 有会话默认展开、空分区默认收起；用户折叠后选择持久生效
 */
export function RecentGroup({
    activeSessionId, onAssign, assignPendingSessionId, ...shared
}: RecentGroupProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const handleSessionClick = useSessionRowNavigate()

    const {
        sessions, visibleSessions,
        expanded, toggleExpanded,
        isLoadingInitial, isLoadingMore,
        showCollapse, canShowMore, remainingCount,
        showMore, collapse,
    } = useRecentSessions(activeSessionId, true)

    // 新建会话（游离）：不带项目信息
    const handleNewSession = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        navigate({ to: '/sessions/new', search: { cwd: undefined } })
    }, [navigate])

    // 行内追加操作：归入项目…
    const renderExtraAction = useCallback((session: Session) => (
        <ActionButton
            $token={token}
            title={t('project.assignTo')}
            disabled={session.id === assignPendingSessionId}
            onClick={(e) => { e.stopPropagation(); onAssign(session) }}
        >
            <FolderAddOutlined style={{ fontSize: 11 }} />
        </ActionButton>
    ), [t, token, onAssign, assignPendingSessionId])

    // 展开即撑开：空分区展开时展示「暂无会话」占位，加载中展示骨架
    const wrapperExpanded = expanded

    return (
        <GroupContainer>
            <SectionTitleRow
                role="button"
                aria-expanded={expanded}
                onClick={toggleExpanded}
            >
                <SectionChevron $token={token} $expanded={expanded}>
                    <ChevronRight size={12} />
                </SectionChevron>
                <SectionTitle $token={token}>{t('nav.recent')}</SectionTitle>
                <SectionActionButton
                    $token={token}
                    className="section-extra"
                    title={t('nav.newSessionUnassigned')}
                    onClick={handleNewSession}
                >
                    <SquarePen size={12} />
                </SectionActionButton>
            </SectionTitleRow>
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
