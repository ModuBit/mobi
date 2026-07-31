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
 * 后台任务面板
 * 在 ComposerInfoPanel 中展示所有后台任务卡片列表（运行中 + 终态）
 */

import { useRef, useState, useEffect } from 'react'
import { theme } from 'antd'
import { Global, css } from '@emotion/react'
import { Loader } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BackgroundTaskCard } from './BackgroundTaskCard'
import { ClearStateButton, type ClearRuntimeStateField } from './ClearStateButton'
import { useBackgroundTasks } from '@/core/data/stores/backgroundTasksStore'
import type { BackgroundTask } from '@/domain/chat/types'
import type { MobiApi } from '@/core/data/api/client'

const STATUS_ORDER: Record<BackgroundTask['status'], number> = {
    running: 0,
    completed: 1,
    failed: 2,
    stopped: 3,
}

const spinKeyframes = css`
@keyframes bgtask-panel-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
`

export function BackgroundTaskPanel({ sessionId, api, onTaskClick, onClear }: {
    sessionId: string
    api: MobiApi
    onTaskClick: (task: BackgroundTask) => void
    onClear: (sessionId: string, clearFields: ClearRuntimeStateField[]) => Promise<void>
}) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const tasks = useBackgroundTasks(sessionId)
    const wrapperRef = useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [hasOverflow, setHasOverflow] = useState(false)
    const [narrow, setNarrow] = useState(false)

    // 监听容器宽度，窄于阈值时卡片撑满纵向排列
    useEffect(() => {
        const el = wrapperRef.current
        if (!el) return
        const observer = new ResizeObserver(() => {
            setNarrow(el.clientWidth < 460)
        })
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const observer = new ResizeObserver(() => {
            setHasOverflow(el.scrollHeight > el.clientHeight)
        })
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    if (tasks.length === 0) return null

    const sortedTasks = [...tasks].sort(
        (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
    )

    let running = 0
    for (const t of tasks) {
        if (t.status === 'running') running++
    }

    const handleStop = async (e: React.MouseEvent, task: BackgroundTask) => {
        e.stopPropagation()
        try {
            await api.sessions.stopTask(sessionId, task.taskId)
        } catch { /* 静默忽略 */ }
    }

    return (
        <div ref={wrapperRef}>
            <Global styles={spinKeyframes} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                {running > 0 && (
                    <Loader size={12} style={{
                        color: token.colorTextQuaternary,
                        animation: 'bgtask-panel-spin 1s linear infinite',
                    }} />
                )}
                <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                    {t('chat.backgroundTask.panelTitle', 'Background Tasks')}
                </span>
                <span style={{
                    fontSize: 10, color: token.colorTextQuaternary,
                    background: token.colorBgTextHover,
                    padding: '0 4px', borderRadius: 4,
                }}>
                    {tasks.length}
                </span>
                <ClearStateButton
                    sessionId={sessionId}
                    clearField="backgroundTasks"
                    onClear={onClear}
                />
            </div>
            <div ref={containerRef} style={{ maxHeight: 96, overflow: 'hidden', position: 'relative' }}>
                <div style={{
                    display: 'flex', gap: 6, flexWrap: 'wrap',
                    flexDirection: narrow ? 'column' : 'row',
                    '--agent-card-width': narrow ? '100%' : '200px',
                } as React.CSSProperties}>
                    {sortedTasks.map(task => (
                        <BackgroundTaskCard
                            key={task.taskId}
                            task={task}
                            onClick={() => onTaskClick(task)}
                            onStop={task.status === 'running' ? (e) => handleStop(e, task) : undefined}
                        />
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
        </div>
    )
}
