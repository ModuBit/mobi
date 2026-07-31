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
import { STATUS_DOT_COLORS } from '@/components/tool-card/toolIcons'

/**
 * goal 徽标（StatusBar 内渲染，靠右）。
 *
 * 仅 active 态存在：达成(met:true)后 cli 立即 reportGoalStatus(null) → goalStatus=null →
 * 徽标不渲染，所以这里统一用运行中状态色（STATUS_DOT_COLORS.running = #4dabf7 蓝），
 * 与 StatusBar 里 StatusStateIcon 的 running 态同款，复用全 app 唯一状态色来源。
 *
 * 概要只显示 `◎ active` 状态标识（尽量短）；condition 全文不进徽标，只出现在 click 详情里：
 * condition 全文 / evaluator reason / 统计 / 清理按钮(仅 sessionId+onClear 都传时)。
 * 统一 click 触发——桌面/移动端一致，移动端无需 hover。用 Popover 而非 Tooltip ——
 * overlay 可交互，手指/鼠标能移进去点清理按钮。
 */
const Badge = styled.span`
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    line-height: 1.6;
    color: ${STATUS_DOT_COLORS.running};
    background: ${STATUS_DOT_COLORS.running}1f;
    cursor: default;
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
            trigger="click"
            overlayStyle={{ maxWidth: 280 }}
        >
            <Badge>◎ active</Badge>
        </Popover>
    )
}
