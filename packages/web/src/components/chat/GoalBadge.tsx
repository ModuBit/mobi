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
import { Popover } from 'antd'
import type { GoalStatus } from '@mobi/shared'
import type { ClearRuntimeStateField } from '@/components/composer/ClearStateButton'
import { ClearStateButton } from '@/components/composer/ClearStateButton'

/**
 * goal 徽标（StatusBar 内渲染）。
 *
 * 仅 active 态存在：达成(met:true)后 cli 立即 reportGoalStatus(null) → goalStatus=null →
 * 徽标不渲染，所以这里统一 primary 蓝(运行提示色)。
 *
 * 收起只显示 ◎ active + condition 截断；hover 出 Popover 详情：
 * condition 全文 / evaluator reason / 统计 / 清理按钮(仅 sessionId+onClear 都传时)。
 * 用 Popover 而非 Tooltip —— overlay 可交互，鼠标能移进去点清理按钮。
 */
const Badge = styled.span`
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    line-height: 1.6;
    color: var(--ant-color-primary);
    background: var(--ant-color-primary-bg);
    cursor: default;
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

const Detail = styled.div`
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 260px;
`

const DetailCondition = styled.div`
    font-size: 12px;
    line-height: 1.5;
    color: var(--ant-color-text);
    word-break: break-word;
`

const DetailReason = styled.div`
    font-size: 11px;
    font-style: italic;
    color: var(--ant-color-text-secondary);
    background: var(--ant-color-fill-quaternary);
    padding: 3px 6px;
    border-radius: 4px;
    line-height: 1.5;
    word-break: break-word;
`

const DetailStats = styled.div`
    font-size: 11px;
    color: var(--ant-color-text-tertiary);
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
`

const DetailClear = styled.div`
    margin-top: 2px;
    align-self: flex-start;
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
    const hasStats =
        goal.iterations !== undefined ||
        goal.durationMs !== undefined ||
        goal.tokens !== undefined

    const detail = (
        <Detail>
            <DetailCondition>{goal.condition}</DetailCondition>
            {goal.reason ? (
                <DetailReason>evaluator · {goal.reason}</DetailReason>
            ) : null}
            {hasStats ? (
                <DetailStats>
                    {goal.iterations !== undefined ? <span>iter {goal.iterations}</span> : null}
                    {goal.durationMs !== undefined ? <span>{goal.durationMs}ms</span> : null}
                    {goal.tokens !== undefined ? <span>{goal.tokens} tok</span> : null}
                </DetailStats>
            ) : null}
            {canClear ? (
                <DetailClear>
                    <ClearStateButton
                        sessionId={sessionId!}
                        clearField="goalStatus"
                        onClear={onClear!}
                    />
                </DetailClear>
            ) : null}
        </Detail>
    )

    return (
        <Popover
            content={detail}
            trigger="hover"
            mouseEnterDelay={0.3}
            mouseLeaveDelay={0.3}
            overlayStyle={{ maxWidth: 280 }}
        >
            <Badge>
                <Dot />
                ◎ active
                <Condition>{goal.condition}</Condition>
            </Badge>
        </Popover>
    )
}
