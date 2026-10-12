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

import { Tooltip, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'

/**
 * fork 行状态小徽标（fork-session spec §4.3）：
 * - pending：待激活（蓝灰中性），首条消息激活后随 forkFrom 清除而消失
 * - error：激活失败（红），tooltip 展示 reason 映射文案
 * 桌面/移动端会话行共用，宽度克制（不挤占标题）。
 */
export function ForkStateBadge({ variant, errorText }: { variant: 'pending' | 'error'; errorText?: string | null }) {
    const { token } = antTheme.useToken()
    const { t } = useTranslation()

    const isError = variant === 'error'
    const label = isError ? t('session.fork.errorBadge') : t('session.fork.pendingBadge')
    const color = isError ? token.colorError : token.colorTextSecondary

    const badge = (
        <span
            data-testid={`fork-state-badge-${variant}`}
            style={{
                flexShrink: 0,
                fontSize: 10,
                lineHeight: '16px',
                padding: '0 5px',
                borderRadius: 4,
                color,
                background: isError ? token.colorErrorBg : token.colorFillSecondary,
                border: `1px solid ${isError ? token.colorErrorBorder : token.colorBorderSecondary}`,
            }}
        >
            {label}
        </span>
    )

    if (!isError || !errorText) return badge
    return <Tooltip title={errorText}>{badge}</Tooltip>
}
