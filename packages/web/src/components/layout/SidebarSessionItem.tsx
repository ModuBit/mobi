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
import styled from '@emotion/styled'
import type { Session } from '@/core/data/api/types'
import { formatRelativeTime } from '@/core/utils/timeFormat'
import { getSessionDisplayName } from '@/core/utils/sessionUtils'

const { useToken } = antTheme

/**
 * 会话状态类型
 * - active: 活跃且正在运行
 * - running: 正在处理中
 * - idle: 活跃但空闲
 * - inactive: 未激活
 */
type SessionStatus = 'active' | 'running' | 'idle' | 'inactive'

/** 根据 Session 数据判断状态 */
function getSessionStatus(session: Session): SessionStatus {
    if (!session.active) return 'inactive'
    const pendingRequests = session.agentState?.requests
    if (pendingRequests && Object.keys(pendingRequests).length > 0) return 'active'
    if (session.running) return 'running'
    return 'idle'
}

/** 状态对应的圆点颜色 */
const STATUS_COLORS: Record<SessionStatus, string> = {
    active: '#faad14',   // 金色 — 等待权限
    running: '#52c41a',  // 绿色 — 运行中
    idle: '#1677ff',     // 蓝色 — 空闲
    inactive: '#d9d9d9',  // 灰色 — 未激活
}

// 会话列表项容器
const ItemContainer = styled.button<{
    $active: boolean
    $token: ReturnType<typeof useToken>['token']
}>`
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 32px;
    padding: 0 8px;
    border: none;
    background: ${props => props.$active ? props.$token.colorPrimaryBg : 'transparent'};
    color: ${props => props.$active ? props.$token.colorPrimary : props.$token.colorText};
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    text-align: left;
    transition: all 0.15s;

    &:hover {
        background: ${props => props.$token.colorPrimaryBg};
    }
`

// 状态圆点
const StatusDot = styled.span<{ $color: string }>`
    width: 6px;
    height: 6px;
    min-width: 6px;
    border-radius: 50%;
    background: ${props => props.$color};
`

// 会话名称
const SessionName = styled.span`
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

// 相对时间
const TimeLabel = styled.span<{ $token: ReturnType<typeof useToken>['token'] }>`
    flex-shrink: 0;
    font-size: 11px;
    color: ${props => props.$token.colorTextQuaternary};
    white-space: nowrap;
`

interface SidebarSessionItemProps {
    /** 会话数据 */
    session: Session
    /** 是否为当前活跃会话 */
    active: boolean
    /** 点击回调 */
    onClick: () => void
}

/**
 * 侧边栏会话列表项
 * 紧凑单行展示，包含状态圆点、名称、相对时间
 */
export function SidebarSessionItem({ session, active, onClick }: SidebarSessionItemProps) {
    const { token } = useToken()

    const status = getSessionStatus(session)
    const statusColor = STATUS_COLORS[status]
    const displayName = getSessionDisplayName(session)
    const relativeTime = formatRelativeTime(session.updatedAt)

    return (
        <ItemContainer $active={active} $token={token} onClick={onClick}>
            <StatusDot $color={statusColor} />
            <SessionName>{displayName}</SessionName>
            <TimeLabel $token={token}>{relativeTime}</TimeLabel>
        </ItemContainer>
    )
}
