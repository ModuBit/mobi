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

import { theme } from 'antd'
import { PixelAvatar } from '@/components/pixel-avatar/PixelAvatar'
import { STATUS_DOT_COLORS, type StatusDotState } from '@/components/tool-card/toolIcons'
import type { TeamMember } from '@mobi/shared'

export type TeamAgentCardProps = {
    member: TeamMember
    teamName: string
}

/**
 * 团队成员卡片
 * 展示单个团队成员的名称、状态和团队归属
 */
export function TeamAgentCard({ member, teamName }: TeamAgentCardProps) {
    const { token } = theme.useToken()
    const rawStatus = member.status ?? 'active'
    // member.status 值域 active/idle/shutdown/running/completed —— 映射到统一 StatusDotState 取色
    const dotState: StatusDotState =
        rawStatus === 'running' || rawStatus === 'active' ? 'running'
            : rawStatus === 'idle' ? 'idle'
            : rawStatus === 'shutdown' ? 'error'
            : 'inactive'
    const labelColor = STATUS_DOT_COLORS[dotState]
    const isActive = dotState === 'running'
    const label = rawStatus === 'active' ? 'running'
        : rawStatus === 'completed' ? 'done'
        : rawStatus === 'shutdown' ? 'stopped'
        : rawStatus

    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            width: 'var(--agent-card-width, 200px)', height: 40,
            padding: '4px 8px', borderRadius: 8,
            cursor: 'default', border: 'none',
            background: token.colorBgTextHover,
            boxSizing: 'border-box',
            opacity: isActive ? 1 : 0.75,
        }}>
            <div style={{ flexShrink: 0, lineHeight: 0 }}>
                <PixelAvatar name={member.name} status={isActive ? 'outputting' : 'inactive'} size={24} />
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    fontSize: 12, fontWeight: 500, color: token.colorText,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{member.name}</span>
                    <span style={{ flexShrink: 0, fontSize: 10, color: labelColor, fontWeight: 400 }}>
                        {label}
                    </span>
                </div>
                <div style={{
                    fontSize: 10, color: token.colorTextTertiary,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                    {teamName}
                </div>
            </div>
        </div>
    )
}
