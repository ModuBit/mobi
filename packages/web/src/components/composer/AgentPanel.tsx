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
 * Agent 面板
 * 在 ComposerInfoPanel 中展示正在运行的 Agent 卡片列表
 */

import { useRef, useState, useEffect } from 'react'
import { theme } from 'antd'
import { useRunningAgents } from '@/core/data/stores/runningAgentsStore'
import { AgentCard } from './AgentCard'
import type { ToolCallBlock } from '@/domain/chat/types'

export function AgentPanel({ sessionId, onAgentClick }: {
    sessionId: string
    onAgentClick: (block: ToolCallBlock) => void
}) {
    const { token } = theme.useToken()
    const agents = useRunningAgents(sessionId)
    const scrollRef = useRef<HTMLDivElement>(null)
    const [showFade, setShowFade] = useState(false)

    // 监听容器尺寸变化和 agent 数量变化，判断是否需要渐变遮罩
    useEffect(() => {
        const el = scrollRef.current
        if (!el) return
        const checkOverflow = () => setShowFade(el.scrollHeight > el.clientHeight)
        checkOverflow()
        const observer = new ResizeObserver(checkOverflow)
        observer.observe(el)
        return () => observer.disconnect()
    }, [agents.length])

    if (agents.length === 0) return null

    return (
        <div style={{ position: 'relative' }}>
            <div
                ref={scrollRef}
                className="hide-scrollbar"
                style={{ maxHeight: 96, overflowY: 'auto' }}
            >
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {agents.map((agent) => (
                        <AgentCard
                            key={agent.block.id}
                            agent={agent}
                            onClick={() => onAgentClick(agent.block)}
                        />
                    ))}
                </div>
            </div>
            {showFade && (
                <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 24,
                    background: `linear-gradient(transparent, ${token.colorBgLayout})`,
                    pointerEvents: 'none',
                }} />
            )}
        </div>
    )
}
