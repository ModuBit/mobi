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

/**
 * 团队成员面板
 * 在 ComposerInfoPanel 中展示所有团队成员卡片列表
 */

import { useRef, useState, useEffect } from 'react'
import { theme } from 'antd'
import { Global, css } from '@emotion/react'
import { Loader } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { TeamAgentCard } from './TeamAgentCard'
import { ClearStateButton } from './ClearStateButton'
import { useTeamMembers, useTeamName, useTeamTasks } from '@/core/data/stores/teamAgentsStore'

const STATUS_ORDER: Record<string, number> = {
    running: 0,
    active: 0,
    idle: 1,
    completed: 2,
    shutdown: 2,
}

const spinKeyframes = css`
@keyframes teamagent-panel-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
`

export function TeamAgentPanel({ sessionId, onClear }: {
    sessionId: string
    onClear: (sessionId: string, clearFields: ('todos' | 'tasks' | 'backgroundTasks' | 'teamState')[]) => Promise<void>
}) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const members = useTeamMembers(sessionId)
    const teamName = useTeamName(sessionId)
    const tasks = useTeamTasks(sessionId)
    const wrapperRef = useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [hasOverflow, setHasOverflow] = useState(false)
    const [narrow, setNarrow] = useState(false)

    // 监听容器宽度，窄于阈值时卡片撑满纵向排列
    useEffect(() => {
        const el = wrapperRef.current
        if (!el) return
        const observer = new ResizeObserver(() => setNarrow(el.clientWidth < 460))
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const observer = new ResizeObserver(() => setHasOverflow(el.scrollHeight > el.clientHeight))
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    if (members.length === 0 || !teamName) return null

    const sortedMembers = [...members].sort(
        (a, b) => (STATUS_ORDER[a.status ?? 'active'] ?? 2) - (STATUS_ORDER[b.status ?? 'active'] ?? 2),
    )

    let activeCount = 0
    for (const m of members) {
        if (m.status === 'running' || m.status === 'active' || !m.status) activeCount++
    }

    return (
        <div ref={wrapperRef}>
            <Global styles={spinKeyframes} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                {activeCount > 0 && (
                    <Loader size={12} style={{
                        color: token.colorTextQuaternary,
                        animation: 'teamagent-panel-spin 1s linear infinite',
                    }} />
                )}
                <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                    {t('chat.team.panelTitle', 'Team')}: {teamName}
                </span>
                <span style={{
                    fontSize: 10, color: token.colorTextQuaternary,
                    background: token.colorBgTextHover,
                    padding: '0 4px', borderRadius: 4,
                }}>
                    {members.length}
                </span>
                <ClearStateButton
                    sessionId={sessionId}
                    clearField="teamState"
                    onClear={onClear}
                />
            </div>
            <div ref={containerRef} style={{ maxHeight: 96, overflow: 'hidden', position: 'relative' }}>
                <div style={{
                    display: 'flex', gap: 6, flexWrap: 'wrap',
                    flexDirection: narrow ? 'column' : 'row',
                    '--agent-card-width': narrow ? '100%' : '200px',
                } as React.CSSProperties}>
                    {sortedMembers.map(member => (
                        <TeamAgentCard key={member.name} member={member} teamName={teamName} />
                    ))}
                </div>
                {hasOverflow && (
                    <div style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0,
                        height: 24,
                        background: `linear-gradient(transparent, ${token.colorBgContainer})`,
                        pointerEvents: 'none',
                    }} />
                )}
            </div>
            {tasks.length > 0 && (
                <div style={{ marginTop: 4 }}>
                    {tasks.map(task => {
                        const taskStatus = task.status ?? 'pending'
                        const taskColor = taskStatus === 'completed' ? '#8c8c8c'
                            : taskStatus === 'in_progress' ? '#52c41a'
                            : '#faad14'
                        return (
                            <div key={task.id} style={{
                                display: 'flex', alignItems: 'center', gap: 4,
                                padding: '2px 0', fontSize: 11,
                                color: taskStatus === 'completed' ? token.colorTextQuaternary : token.colorTextSecondary,
                            }}>
                                <span style={{
                                    width: 6, height: 6, borderRadius: '50%',
                                    background: taskColor, flexShrink: 0,
                                }} />
                                <span style={{
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    flex: 1,
                                }}>
                                    {task.title ?? task.subject ?? task.id}
                                </span>
                                {task.owner && (
                                    <span style={{ fontSize: 10, color: token.colorTextQuaternary, flexShrink: 0 }}>
                                        {task.owner}
                                    </span>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
