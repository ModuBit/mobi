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

import { memo, useCallback } from 'react'
import { theme as antTheme, Typography } from 'antd'
import type { Session } from '@/api/types'
import { useNavigate } from '@tanstack/react-router'
import { formatRelativeTime } from '@/utils/timeFormat'
import { getSessionDisplayName, getModelDisplayName, getCliDisplayName } from '@/utils/sessionUtils'
import styled from '@emotion/styled'

const { Text } = Typography
const { useToken } = antTheme

const CardContainer = styled.div<{ $token: ReturnType<typeof useToken>['token']; $active?: boolean }>`
    padding: 10px 12px;
    cursor: pointer;
    border-radius: ${props => props.$token.borderRadius}px;
    background: ${props => props.$active ? props.$token.colorPrimaryBg : props.$token.colorBgContainer};
    margin-bottom: 4px;
    transition: all 0.2s ease;
    border: none;

    &:hover {
        background: ${props => props.$active ? props.$token.colorPrimaryBgHover : props.$token.colorBgTextHover};
    }

    &:last-child {
        margin-bottom: 0;
    }
`

const FirstRow = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
`

const LeftSection = styled.div`
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
`

const StatusDot = styled.span<{ $active?: boolean; $token: ReturnType<typeof useToken>['token'] }>`
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${props => props.$active ? props.$token.colorSuccess : props.$token.colorTextDisabled};
    flex-shrink: 0;
`

const DisplayName = styled(Text)`
    font-weight: 600;
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
    margin: 0 !important;
`

const TimeText = styled(Text)`
    font-size: 12px;
    flex-shrink: 0;
    margin: 0 !important;
`

const MetaRow = styled.div`
    display: flex;
    align-items: center;
    gap: 12px;
    padding-left: 14px;
`

const MetaText = styled(Text)`
    font-size: 12px;
    margin: 0 !important;
`

interface SessionCardProps {
    session: Session
    active?: boolean
}

function SessionCardInner({ session, active }: SessionCardProps) {
    const navigate = useNavigate()
    const { token } = useToken()

    const handleClick = useCallback(() => {
        navigate({ to: '/sessions/$sessionId', params: { sessionId: session.id } })
    }, [navigate, session.id])

    const displayName = getSessionDisplayName(session)
    const relativeTime = formatRelativeTime(session.updatedAt)
    const metadata = session.metadata as { flavor?: string; model?: string } | undefined
    const cliName = getCliDisplayName(metadata?.flavor)
    const modelName = getModelDisplayName(session.runtimeState?.model ?? metadata?.model)

    return (
        <CardContainer
            $token={token}
            $active={active}
            onClick={handleClick}
        >
            {/* 第一行：状态原点 + 名称 + 时间 */}
            <FirstRow>
                <LeftSection>
                    <StatusDot $active={session.active} $token={token} />
                    <DisplayName>{displayName}</DisplayName>
                </LeftSection>
                <TimeText type="secondary">{relativeTime}</TimeText>
            </FirstRow>

            {/* 第二行：CLI + 模型 */}
            <MetaRow>
                <MetaText type="secondary">{cliName}</MetaText>
                <MetaText type="secondary">·</MetaText>
                <MetaText type="secondary">{modelName}</MetaText>
            </MetaRow>
        </CardContainer>
    )
}

export const SessionCard = memo(SessionCardInner)
