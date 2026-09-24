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
 * 统一「等待确认」徽章
 *
 * 所有「agent 停下来等用户」的阻塞面板（工具审批 / AskUserQuestion / Plan 确认）
 * 共用同一个状态表达——相同等待语义不应看似不同状态（借鉴 ZCode，见
 * docs/research-zcode-interactions.md §四）。面板本体的内容与交互各自独立，
 * 本组件只承载状态胶囊，不承载业务逻辑。
 *
 * 色取 STATUS_DOT_COLORS.awaiting_auth（橙，全 app 唯一状态色来源）+
 * 复用全局 status-icon-breathe 呼吸动画；刻意不用绿色——绿已被 plan 模式
 * 与成功语义占用（与 ZCode 的统一绿是有意偏离）。
 */

import { theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import { STATUS_DOT_COLORS } from '@/components/tool-card/toolIcons'
const Badge = styled.span<{ $textColor: string; $bgColor: string }>`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 12px;
    line-height: 18px;
    color: ${(p) => p.$textColor};
    background: ${(p) => p.$bgColor};
`

const Dot = styled.span`
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${STATUS_DOT_COLORS.awaiting_auth};
    animation: status-icon-breathe 0.45s ease-in-out infinite;
`

export function AwaitingConfirmBadge() {
    const { t } = useTranslation()
    const { token } = antTheme.useToken()

    return (
        <Badge
            data-testid="awaiting-confirm-badge"
            $textColor={token.colorWarningText}
            $bgColor={token.colorWarningBg}
        >
            <Dot />
            {t('common.awaitingConfirm')}
        </Badge>
    )
}
