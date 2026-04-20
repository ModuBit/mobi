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

    if (block.event.type === 'message') {
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

    const content = formatEvent(block.event, t)
    if (content === null) return null

    const d = block.display
    const alignClass = d?.align ? `event-align-${d.align}` : undefined
    const colorValue = d?.color === 'error' || d?.color === 'warning'
        ? 'rgba(239, 68, 68, 0.45)'
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
