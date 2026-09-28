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
import type { SystemNoticeBlock as SystemNoticeBlockType } from '@/domain/chat'

/**
 * 系统提示横幅（CC informational 消息）：紧凑单行样式。
 * - warning 级：主题 warning 色 token（colorWarning/ColorWarningBg）左边条 + 浅底，
 *   light/dark 双档色值由主题 token 各自提供（theme/tokens.ts 两套算法），组件不做硬编码；
 * - 非 warning 级（preventContinuation 命中的 info/notice/suggestion）：中性配色；
 * - 正文原样显示不翻译（CC 文案是权威）；preventContinuation 附「已停止执行」语义标记。
 */
export const SystemNoticeBlock = memo(function SystemNoticeBlock({ block }: { block: SystemNoticeBlockType }) {
    const { token } = antTheme.useToken()
    const { t } = useTranslation()

    const isWarning = block.level === 'warning'
    const accentColor = isWarning ? token.colorWarning : token.colorBorderSecondary
    const backgroundColor = isWarning ? token.colorWarningBg : token.colorBgContainer

    return (
        <div
            data-notice-level={block.level}
            style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
                padding: '6px 10px',
                margin: '4px 0',
                borderRadius: 6,
                borderLeft: `3px solid ${accentColor}`,
                background: backgroundColor,
                fontSize: 12,
                lineHeight: '18px',
                color: isWarning ? token.colorWarningText : token.colorTextSecondary,
            }}
        >
            <span style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {block.content}
            </span>
            {block.preventContinuation && (
                <span
                    style={{
                        flexShrink: 0,
                        fontSize: 11,
                        padding: '0 6px',
                        borderRadius: 4,
                        border: `1px solid ${accentColor}`,
                    }}
                >
                    {t('chat.systemNotice.executionStopped')}
                </span>
            )}
        </div>
    )
})
