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
import type { ClearRuntimeStateField } from '@/components/composer/ClearStateButton'
import { ClearStateButton } from '@/components/composer/ClearStateButton'

/**
 * goal 徽标（StatusBar 内渲染）
 *
 * 纯展示：active / 达成 两态，配色跟随 antd 双主题 CSS 变量
 * （success-bg / primary-bg）。condition 文本超长时 ellipsis，maxWidth 160px 防止撑宽。
 * 当 sessionId 与 onClear 都传时，末尾内嵌清理按钮；否则纯展示。
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
    /** sessionId（与 onClear 同时传入时渲染清理按钮） */
    sessionId?: string
    /** 清理回调（与 sessionId 同时传入时渲染清理按钮） */
    onClear?: (sid: string, fields: ClearRuntimeStateField[]) => Promise<void>
}

export function GoalBadge({ goal, sessionId, onClear }: GoalBadgeProps) {
    const canClear = Boolean(sessionId && onClear)
    return (
        <Badge $met={goal.met}>
            <Dot />
            {goal.met ? '✓ 达成' : '◎ active'}
            <Condition>{goal.condition}</Condition>
            {canClear ? (
                <ClearStateButton
                    sessionId={sessionId!}
                    clearField="goalStatus"
                    onClear={onClear!}
                />
            ) : null}
        </Badge>
    )
}
