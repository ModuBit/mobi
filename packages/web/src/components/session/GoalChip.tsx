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

/** 收起态 goal chip：圆点 + 状态文案 + 条件摘要 + 清理按钮。右贴吊顶。 */
const Chip = styled.span<{ $met: boolean }>`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    padding: 2px 4px 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    ${({ $met }) =>
        $met
            ? `color: var(--ant-color-success); background: var(--ant-color-success-bg);`
            : `color: var(--ant-color-primary); background: var(--ant-color-primary-bg);`}
`

const Dot = styled.span<{ $met: boolean }>`
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    flex-shrink: 0;
`

const ConditionText = styled.span`
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

export interface GoalChipProps {
    goal: GoalStatus
    sessionId: string
    onClear: (sid: string, fields: ClearRuntimeStateField[]) => Promise<void>
}

/**
 * Goal 状态 chip（吊顶收起态）。
 *
 * 圆点颜色按 met/active 区分（success / primary），
 * 条件文案 ellipsis 截断，附 ClearStateButton 快速清理 goalStatus。
 */
export function GoalChip({ goal, sessionId, onClear }: GoalChipProps) {
    return (
        <Chip $met={goal.met}>
            <Dot $met={goal.met} />
            {goal.met ? '✓ 达成' : '◎ active'}
            <ConditionText>{goal.condition}</ConditionText>
            <ClearStateButton sessionId={sessionId} clearField="goalStatus" onClear={onClear} />
        </Chip>
    )
}
