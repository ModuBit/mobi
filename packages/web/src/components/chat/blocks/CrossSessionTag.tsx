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
import { Inbox, Clock, Repeat } from 'lucide-react'

/**
 * 入站 turn 来源（spec 批次 D）：peer=跨会话消息 / scheduled=定时任务 / loop=/loop 唤醒。
 * 仅 hook 观测的入站 turn 落库时携带；普通 webapp user 消息缺省，UI 回退 peer 行为。
 */
type TurnOrigin = 'peer' | 'scheduled' | 'loop'

/**
 * 跨会话入站消息来源标签：user 气泡 header 上的胶囊 chip。
 *
 * 按 turnOrigin 切图标 + 文案：
 * - peer（或缺省，旧消息兼容）：Inbox +「来自 {from}」（from 为 null 时显示通用文案）
 * - scheduled：Clock +「⏰ 定时任务」（不看 from）
 * - loop：Repeat +「🔁 /loop」（不看 from）
 *
 * 挂在 antdx Bubble 的 header 槽位（填充背景之外的气泡体上方）；user 气泡为
 * placement: end，antdx 对该 placement 的 header 用 row-reverse 布局，chip 自动
 * 右对齐、与气泡对齐方向一致，组件内无需关心对齐。
 */
export function CrossSessionTag({ from, turnOrigin }: { from: string | null; turnOrigin?: TurnOrigin }) {
    const { t } = useTranslation()
    const { token } = theme.useToken()

    // turnOrigin 缺省 / peer：回退 peer 行为（Inbox + from 驱动文案），旧消息兼容
    const Icon = turnOrigin === 'scheduled' ? Clock : turnOrigin === 'loop' ? Repeat : Inbox
    const label = turnOrigin === 'scheduled'
        ? t('chat.message.turnOriginScheduled')
        : turnOrigin === 'loop'
            ? t('chat.message.turnOriginLoop')
            : from !== null
                ? t('chat.message.crossSessionFrom', { from })
                : t('chat.message.crossSessionFromUnknown')

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
            <Icon size={11} strokeWidth={2} style={{ color: token.colorTextTertiary, flexShrink: 0 }} aria-hidden />
            {label}
        </span>
    )
}
