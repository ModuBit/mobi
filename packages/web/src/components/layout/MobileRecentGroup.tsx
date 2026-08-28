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

import { useCallback } from 'react'
import { theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useRecentSessions } from '@/core/data/hooks/queries/useRecentSessions'
import { useMenuNavigate } from './useMenuNavigate'
import {
    SectionHeader, SectionTitleText, SectionChevron,
    SessionListWrapper, SessionListInner, EmptyRow,
} from './mobileProjectList.styles'
import { MobileSessionItem } from './MobileSessionItem'
import { SessionSkeletonRows } from './SessionSkeletonRows'
import { SessionListFooter, getSessionListDisplayState } from './SessionListFooter'

const { useToken } = antTheme

interface MobileRecentGroupProps {
    activeSessionId: string | undefined
    onSessionAction: (sessionId: string) => void
}

/**
 * 移动端「最近」分区：游离（未归入项目）会话，与「项目」分区平级（与桌面端一致）。
 * 有会话默认展开、空分区默认收起；用户折叠后选择持久生效
 */
export function MobileRecentGroup({ activeSessionId, onSessionAction }: MobileRecentGroupProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const navigateFromMenu = useMenuNavigate()

    const {
        sessions, visibleSessions,
        expanded, toggleExpanded,
        isLoadingInitial, isLoadingMore,
        showCollapse, canShowMore, remainingCount,
        showMore, collapse,
    } = useRecentSessions(activeSessionId, true)

    const handleSessionClick = useCallback((sessionId: string) => {
        navigateFromMenu(() => navigate({ to: '/sessions/$sessionId', params: { sessionId } }))
    }, [navigate, navigateFromMenu])

    // 展开即撑开：空分区展开时展示「暂无会话」占位，加载中展示骨架
    const wrapperExpanded = expanded
    const { showSkeleton, showEmpty, showFooter } = getSessionListDisplayState({
        isLoadingInitial, sessionCount: sessions.length, showCollapse, canShowMore, isLoadingMore,
    })

    return (
        <div>
            <SectionHeader
                $token={token}
                role="button"
                aria-expanded={expanded}
                onClick={toggleExpanded}
            >
                <SectionChevron $token={token} $expanded={expanded}>
                    <ChevronRight size={14} />
                </SectionChevron>
                <SectionTitleText>{t('nav.recent')}</SectionTitleText>
            </SectionHeader>
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
