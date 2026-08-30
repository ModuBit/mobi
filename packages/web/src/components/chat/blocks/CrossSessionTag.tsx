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
import { useTranslation } from 'react-i18next'
import { Inbox } from 'lucide-react'

/**
 * 跨会话入站消息来源标签：user 气泡 header 上的胶囊 chip（Inbox 图标 +「来自 {from}」）。
 * from 为 null（信封缺 from-name 的降级落库）时显示通用文案。
 *
 * 挂在 antdx Bubble 的 header 槽位（填充背景之外的气泡体上方）；user 气泡为
 * placement: end，antdx 对该 placement 的 header 用 row-reverse 布局，chip 自动
 * 右对齐、与气泡对齐方向一致，组件内无需关心对齐。
 */
export function CrossSessionTag({ from }: { from: string | null }) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    return (
        <span
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '1px 8px 1px 6px',
                borderRadius: 999,
                background: token.colorFillQuaternary,
                border: `1px solid ${token.colorBorderSecondary}`,
                fontSize: 11,
                lineHeight: '16px',
                color: token.colorTextSecondary,
                whiteSpace: 'nowrap',
            }}
        >
            <Inbox size={11} strokeWidth={2} style={{ color: token.colorTextTertiary, flexShrink: 0 }} aria-hidden />
            {from !== null
                ? t('chat.message.crossSessionFrom', { from })
                : t('chat.message.crossSessionFromUnknown')}
        </span>
    )
}
