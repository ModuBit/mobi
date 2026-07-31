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

import styled from '@emotion/styled'
import type { GoalStatus } from '@mobi/shared'

/**
 * goal 徽标（composer 输入框上方）
 *
 * 纯展示：active / 达成 两态，配色跟随 antd 双主题 CSS 变量
 * （success-bg / primary-bg，Task 8 已确认双主题可用）。
 * condition 文本超长时 ellipsis，maxWidth 160px 防止撑宽 composer。
 * 不含清理按钮 —— 清理走吊顶两处（GoalChip / GoalDetail）。
 */
const Badge = styled.span<{ $met: boolean }>`
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    line-height: 1.6;
    ${({ $met }) =>
        $met
            ? `color: var(--ant-color-success); background: var(--ant-color-success-bg);`
            : `color: var(--ant-color-primary); background: var(--ant-color-primary-bg);`}
`

const Dot = styled.span`
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    flex-shrink: 0;
`

const Condition = styled.span`
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

interface GoalBadgeProps {
    goal: GoalStatus
}

export function GoalBadge({ goal }: GoalBadgeProps) {
    return (
        <Badge $met={goal.met}>
            <Dot />
            {goal.met ? '✓ 达成' : '◎ active'}
            <Condition>{goal.condition}</Condition>
        </Badge>
    )
}
