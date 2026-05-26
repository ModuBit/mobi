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
 * 后台 Bash 任务抽屉内容
 * 展示任务描述、指标和输出摘要，支持停止运行中的任务
 */

import { theme, Typography } from 'antd'
import { CircleStop } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { BackgroundTask } from '@/domain/chat/types'
import type { MobiApi } from '@/core/data/api/client'

const { Text } = Typography

export function BashDrawerContent({ task, sessionId, api }: {
    task: BackgroundTask
    sessionId: string
    api: MobiApi
}) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const isRunning = task.status === 'running'

    const handleStop = async () => {
        try {
            await api.sessions.stopTask(sessionId, task.taskId)
        } catch { /* 静默忽略 */ }
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text strong style={{ fontSize: 13 }}>{task.description}</Text>
                {isRunning && (
                    <button onClick={handleStop} style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '4px 10px', background: token.colorErrorBg,
                        border: 'none', borderRadius: 4, cursor: 'pointer',
                        fontSize: 11, color: token.colorError,
                    }}>
                        <CircleStop size={12} />
                        {t('chat.backgroundTask.stop', 'Stop')}
                    </button>
                )}
            </div>
            {task.metrics && (
                <div style={{ fontSize: 11, color: token.colorTextTertiary, fontFamily: 'var(--font-mono)' }}>
                    {task.metrics.durationMs > 0 && `${(task.metrics.durationMs / 1000).toFixed(1)}s`}
                    {task.metrics.durationMs > 0 && task.metrics.tokens > 0 && ' · '}
                    {task.metrics.tokens > 0 && `${task.metrics.tokens} tokens`}
                </div>
            )}
            {task.summary ? (
                <div style={{
                    background: token.colorBgContainer,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: 6, padding: 8,
                    fontFamily: 'var(--font-mono)', fontSize: 12,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    maxHeight: 300, overflow: 'auto',
                }}>
                    {task.summary}
                </div>
            ) : (
                <div style={{ fontSize: 12, color: token.colorTextQuaternary }}>
                    {isRunning ? t('chat.backgroundTask.running', 'Running...') : t('chat.backgroundTask.noOutput', '(no output)')}
                </div>
            )}
        </div>
    )
}
