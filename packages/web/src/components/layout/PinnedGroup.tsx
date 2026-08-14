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

import { theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Pin } from 'lucide-react'
import { usePinnedSessions } from '@/core/data/hooks/queries/usePinnedSessions'
import {
    GroupContainer, SectionTitleRow, SectionTitle, SectionChevron,
    SessionListWrapper, SessionListInner,
} from './sidebarProjects.styles'
import { SessionRowsList } from './SessionRowsList'
import type { SessionListSharedProps } from './SessionRowsList'
import { useSessionRowNavigate } from './useSessionRowNavigate'

const { useToken } = antTheme

/**
 * 「置顶」分区：置顶会话（跨项目/游离），与「项目」「最近」平级，置于最前。
 * 有会话默认展开、空分区默认收起；用户折叠后选择持久生效。
 * 置顶/取消置顶入口在会话行 hover 操作（SessionRow 通用 pin 按钮）
 */
export function PinnedGroup({ activeSessionId, ...shared }: SessionListSharedProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const handleSessionClick = useSessionRowNavigate()

    const {
        sessions, visibleSessions,
        expanded, toggleExpanded,
        isLoadingInitial, isLoadingMore,
        showCollapse, canShowMore, remainingCount,
        showMore, collapse,
    } = usePinnedSessions(activeSessionId, true)

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
                <SectionTitle $token={token}>{t('nav.pinned')}</SectionTitle>
                <Pin size={12} style={{ color: token.colorTextQuaternary, flexShrink: 0 }} />
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
                    />
                </SessionListInner>
            </SessionListWrapper>
        </GroupContainer>
    )
}
