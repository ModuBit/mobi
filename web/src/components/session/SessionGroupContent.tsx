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

import { Button, Skeleton, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { useGroupSessions } from '@/hooks/queries/useGroupSessions'
import { SessionCard } from './SessionCard'
import styled from '@emotion/styled'

const { useToken } = antTheme

const ContentContainer = styled.div`
    padding: 4px 0;
`

const LoadMoreContainer = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    justify-content: center;
    padding: 12px 0;
    border-top: 1px solid ${props => props.$token.colorBorderSecondary};
    margin-top: 8px;
`

interface SessionGroupContentProps {
    groupKey: string
    selectedSessionId?: string
}

/**
 * 会话分组内容组件
 * 显示分组内的会话列表，支持加载更多
 */
export function SessionGroupContent({ groupKey, selectedSessionId }: SessionGroupContentProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useGroupSessions(groupKey)

    // 首次加载
    if (isLoading) {
        return (
            <ContentContainer>
                <Skeleton active paragraph={{ rows: 2 }} />
            </ContentContainer>
        )
    }

    // 获取所有页面的 sessions
    const sessions = data?.pages.flatMap(page => page.sessions) ?? []

    return (
        <ContentContainer>
            {sessions.map((session) => (
                <SessionCard
                    key={session.id}
                    session={session}
                    active={selectedSessionId === session.id}
                />
            ))}

            {/* 加载更多按钮 */}
            {hasNextPage && (
                <LoadMoreContainer $token={token}>
                    <Button
                        type="link"
                        onClick={() => fetchNextPage()}
                        loading={isFetchingNextPage}
                    >
                        {t('sessionGroup.loadMore')}
                    </Button>
                </LoadMoreContainer>
            )}
        </ContentContainer>
    )
}
