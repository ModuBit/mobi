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
import { History, Plus } from 'lucide-react'
import { useRecentSessions } from '@/core/data/hooks/queries/useRecentSessions'
import {
    GroupHeader, FolderIcon, GroupName, NewSessionBtn,
    SessionListWrapper, SessionListInner, EmptyRow,
} from './mobileProjectList.styles'
import { MobileSessionItem } from './MobileSessionItem'
import { SessionSkeletonRows } from './SessionSkeletonRows'
import { SessionListFooter, getSessionListDisplayState } from './SessionListFooter'

const { useToken } = antTheme

interface MobileRecentGroupProps {
    activeSessionId: string | undefined
    onSessionAction: (sessionId: string) => void
    onCloseMenu: () => void
}

/**
 * 移动端「最近」分组：游离（未归入项目）会话，默认展开（与桌面端一致）
 */
export function MobileRecentGroup({ activeSessionId, onSessionAction, onCloseMenu }: MobileRecentGroupProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()

    // 「最近」默认展开（用户仍可手动折叠）
    const {
        sessions, visibleSessions,
        expanded, toggleExpanded,
        isLoadingInitial, isLoadingMore,
        showCollapse, canShowMore, remainingCount,
        showMore, collapse,
    } = useRecentSessions(activeSessionId, true)

    const handleSessionClick = useCallback((sessionId: string) => {
        onCloseMenu()
        navigate({ to: '/sessions/$sessionId', params: { sessionId } })
    }, [navigate, onCloseMenu])

    // 新建会话（游离）：不带项目信息
    const handleNewSession = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        onCloseMenu()
        navigate({ to: '/sessions/new', search: { cwd: undefined } })
    }, [navigate, onCloseMenu])

    // 展开即撑开：空分组展示「暂无会话」占位（点击有反馈），加载中展示骨架
    const wrapperExpanded = expanded
    const { showSkeleton, showEmpty, showFooter } = getSessionListDisplayState({
        isLoadingInitial, sessionCount: sessions.length, showCollapse, canShowMore, isLoadingMore,
    })

    return (
        <div>
            <GroupHeader $token={token} onClick={toggleExpanded}>
                <FolderIcon $token={token}>
                    <History size={18} />
                </FolderIcon>
                <GroupName $token={token}>{t('nav.recent')}</GroupName>
                <NewSessionBtn $token={token} onClick={handleNewSession} aria-label={t('nav.newSessionUnassigned')}>
                    <Plus size={18} />
                </NewSessionBtn>
            </GroupHeader>
            <SessionListWrapper $expanded={wrapperExpanded}>
                <SessionListInner>
                    {showSkeleton ? (
                        <SessionSkeletonRows variant="mobile" rows={2} />
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
