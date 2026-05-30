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

import { memo } from 'react'
import { theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import type { AgentEventBlock as AgentEventBlockType } from '@/domain/chat'
import { formatEvent } from '@/domain/chat'

/** Agent 事件渲染 */
export const AgentEventBlock = memo(function AgentEventBlock({ block }: { block: AgentEventBlockType }) {
    const { token } = antTheme.useToken()
    const { t } = useTranslation()

    // 后台任务完成卡片
    if (block.event.type === 'bg-task-completed') {
        const evt = block.event as { type: string; [k: string]: unknown }
        const status = String(evt.status ?? 'completed')
        const summary = typeof evt.summary === 'string' ? evt.summary : undefined
        const description = typeof evt.description === 'string' ? evt.description : 'Background task'
        return (
            <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', margin: '4px 0',
                borderRadius: 8, background: token.colorBgContainer,
                boxShadow: `inset 0px 0px 0px 1px ${token.colorBorderSecondary}`,
            }}>
                <span style={{ fontSize: 14 }}>
                    {status === 'completed' ? '✓' : status === 'failed' ? '✗' : '■'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: token.colorText }}>
                        {description}
                    </div>
                    {summary && (
                        <div style={{ fontSize: 11, color: token.colorTextSecondary, marginTop: 2 }}>
                            {summary}
                        </div>
                    )}
                </div>
            </div>
        )
    }

    if (block.event.type === 'message' || block.event.type === 'summary') {
        return (
            <div style={{
                padding: '4px 0',
                fontSize: 11,
                color: token.colorTextQuaternary,
            }}>
                {String(block.event.message ?? '')}
            </div>
        )
    }

    const content = formatEvent(block.event, t, block.createdAt)
    if (content === null) return null

    const d = block.display
    const alignClass = d?.align ? `event-align-${d.align}` : undefined
    const colorValue = d?.color === 'error'
        ? token.colorError
        : d?.color === 'warning'
            ? token.colorWarning
            : token.colorTextQuaternary
    return (
        <div
            className={alignClass}
            style={{
                padding: d?.padding === false ? 0 : '4px 0',
                fontSize: 11,
                color: colorValue,
            }}
        >
            {content}
        </div>
    )
})
