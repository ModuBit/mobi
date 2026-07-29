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
import type { ContextUsage } from '@mobi/shared'

/** SessionContextBar 收起态追加的百分比 chip（吊顶主行末尾） */
export function ContextUsageChip({ usage }: { usage: ContextUsage }) {
    const { token } = theme.useToken()
    const pct = Math.round(usage.percentage)
    const tone = pct >= 75 ? 'error' : pct >= 50 ? 'warning' : 'info'
    const color = tone === 'error'
        ? token.colorError
        : tone === 'warning'
            ? token.colorWarning
            : token.colorTextSecondary
    const dotColor = tone === 'error'
        ? token.colorError
        : tone === 'warning'
            ? token.colorWarning
            : token.colorInfo

    return (
        <span
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontFamily: 'var(--ant-font-family-code, ui-monospace, monospace)',
                fontSize: 11,
                fontWeight: 600,
                color,
                background: token.colorFillQuaternary,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 3,
                padding: '1px 7px',
                fontVariantNumeric: 'tabular-nums',
                marginLeft: 'auto',
            }}
        >
            <span style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: dotColor,
            }} />
            {pct}%
        </span>
    )
}
