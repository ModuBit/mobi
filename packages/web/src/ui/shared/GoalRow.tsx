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
import { useMemo } from 'react'
import { Goal, Ellipsis } from 'lucide-react'
import type { GoalStatus } from '@mobi/shared'
import type { ClearRuntimeStateField } from '@/ui/base/interactive/ClearStateButton'
import { ClearStateButton } from '@/ui/base/interactive/ClearStateButton'
import { IconButton } from '@/ui/base/interactive/IconButton'
import { Popover } from '@/ui/base/interactive/popover/Popover'
import { formatDuration, formatTokens } from '@/core/lib/metricsFormat'
import { useTranslation } from 'react-i18next'

/**
 * goal 状态行（composer 上方独占整行）。
 *
 * 仅 active 态存在：达成(met:true)后 cli 立即 reportGoalStatus(null) → goalStatus=null →
 * 整行不渲染。图标用 lucide `Goal` 的默认墨色（tertiary），不再保留早期徽标时代的
 * 品牌蓝强调——行的存在本身就是强调，图标只做语义标识。
 *
 * 形态参照 ChatGPT desktop：图标 + 「进行中的目标」+ condition（单行省略）+ 耗时，
 * 详情/清理动作在行尾。condition 全文、evaluator reason、统计收进 click 详情
 * （Popover 而非 Tooltip —— overlay 可交互）。动作在 hover 设备上悬停/聚焦现形，
 * 触屏常驻（触屏没有 hover，常驻不会「卡住」）。无背景色：行直接落在 composer 上方的底色上。
 */
const Row = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    width: 100%;
    padding: 6px 10px;
    border-radius: var(--radius-control-sm);

    /* 触屏没有 hover：动作常驻；hover 设备上悬停/聚焦才现形。
       不用 emotion 组件选择器（需要 babel 插件，vitest 转换链没有） */
    @media (hover: hover) and (pointer: fine) {
        & [data-goal-actions] {
            opacity: 0;
            transition: opacity var(--mobi-duration-fast) ease;
        }
    }
    &:hover [data-goal-actions],
    &:focus-within [data-goal-actions] {
        opacity: 1;
    }
    @media (prefers-reduced-motion: reduce) {
        & [data-goal-actions] {
            transition: none;
        }
    }
`

const GoalIcon = styled.span`
    display: inline-flex;
    flex: none;
    color: var(--ant-color-text-tertiary);
`

const Label = styled.span`
    flex: none;
    font-size: 13px;
    font-weight: 500;
    color: var(--ant-color-text-secondary);
`

const Condition = styled.span`
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    color: var(--ant-color-text);
`

const Separator = styled.span`
    flex: none;
    color: var(--ant-color-text-quaternary);
`

const Duration = styled.span`
    flex: none;
    font-family: var(--font-mono);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    color: var(--ant-color-text-tertiary);
`

const Actions = styled.div`
    display: flex;
    align-items: center;
    gap: 2px;
    flex: none;
    margin-left: auto;
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
    border-radius: var(--radius-square);
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

interface GoalRowProps {
    goal: GoalStatus
    /** sessionId（与 onClear 同时传入时渲染清理动作） */
    sessionId?: string
    /** 清理回调（与 sessionId 同时传入时渲染清理动作） */
    onClear?: (sid: string, fields: ClearRuntimeStateField[]) => Promise<void>
}

export function GoalRow({ goal, sessionId, onClear }: GoalRowProps) {
    const { t } = useTranslation()
    const canClear = Boolean(sessionId && onClear)

    // 详情只在 goal 变化时重建：流式期 composer 每个 chunk 重渲染，不必重造弹出内容
    const detail = useMemo(() => (
        <Detail>
            <DetailCondition>{goal.condition}</DetailCondition>
            {goal.reason ? (
                <DetailReason>evaluator · {goal.reason}</DetailReason>
            ) : null}
            {goal.iterations !== undefined || goal.tokens !== undefined ? (
                <DetailStats>
                    {goal.iterations !== undefined ? <span>iter {goal.iterations}</span> : null}
                    {goal.tokens !== undefined ? <span>{formatTokens(goal.tokens)} tokens</span> : null}
                </DetailStats>
            ) : null}
        </Detail>
    ), [goal])

    return (
        <Row data-testid="goal-row">
            <GoalIcon aria-hidden="true">
                <Goal size={15} />
            </GoalIcon>
            <Label>{t('session.goal.label')}</Label>
            <Condition title={goal.condition}>{goal.condition}</Condition>
            {goal.durationMs !== undefined ? (
                <>
                    <Separator aria-hidden="true">·</Separator>
                    <Duration>{formatDuration(goal.durationMs)}</Duration>
                </>
            ) : null}
            <Actions data-goal-actions data-testid="goal-row-actions">
                <Popover content={detail} trigger="click" maxWidth={280}>
                    <IconButton
                        size={22}
                        icon={<Ellipsis size={16} />}
                        aria-label={t('session.goal.details')}
                    />
                </Popover>
                {canClear ? (
                    <ClearStateButton
                        sessionId={sessionId!}
                        clearFields={["goalStatus"]}
                        onClear={onClear!}
                    />
                ) : null}
            </Actions>
        </Row>
    )
}
