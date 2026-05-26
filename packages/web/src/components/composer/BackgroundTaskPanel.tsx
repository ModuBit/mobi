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
 * 在 ComposerInfoPanel 中展示正在运行的后台任务卡片列表
 */

import { useRef, useState, useEffect } from 'react'
import { theme } from 'antd'
import { Loader } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BackgroundTaskCard } from './BackgroundTaskCard'
import { useBackgroundTasks } from '@/core/data/stores/backgroundTasksStore'
import type { BackgroundTask } from '@/domain/chat/types'
import type { MobiApi } from '@/core/data/api/client'

export function BackgroundTaskPanel({ sessionId, api, onTaskClick }: {
    sessionId: string
    api: MobiApi
    onTaskClick: (task: BackgroundTask) => void
}) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const tasks = useBackgroundTasks(sessionId)
    const containerRef = useRef<HTMLDivElement>(null)
    const [hasOverflow, setHasOverflow] = useState(false)

    // 监听容器尺寸变化，判断是否需要渐变遮罩
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

    const handleStop = async (e: React.MouseEvent, task: BackgroundTask) => {
        e.stopPropagation()
        try {
            // stopTask 方法将在后续任务中添加到 API client
            await (api.sessions as any).stopTask?.(sessionId, task.taskId)
        } catch { /* 静默忽略 */ }
    }

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                <Loader size={12} style={{
                    color: token.colorTextQuaternary,
                    animation: 'bgtask-spin 1s linear infinite',
                }} />
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
            </div>
            <div ref={containerRef} style={{ maxHeight: 96, overflow: 'hidden', position: 'relative' }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {tasks.map(task => (
                        <BackgroundTaskCard
                            key={task.taskId}
                            task={task}
                            onClick={() => onTaskClick(task)}
                            onStop={(e) => handleStop(e, task)}
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
            <style>{`@keyframes bgtask-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
        </div>
    )
}
