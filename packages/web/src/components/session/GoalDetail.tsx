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

/** 展开态 goal 详情卡片：左边框颜色按 met/active 区分，浮在吊顶下沿 */
const Card = styled.div<{ $met: boolean }>`
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-left: 3px solid ${({ $met }) => ($met ? 'var(--ant-color-success)' : 'var(--ant-color-primary)')};
`

const StatusBadge = styled.span<{ $met: boolean }>`
    font-size: 11px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 8px;
    ${({ $met }) =>
        $met
            ? `background: var(--ant-color-success-bg); color: var(--ant-color-success);`
            : `background: var(--ant-color-primary-bg); color: var(--ant-color-primary);`}
`

const Condition = styled.div`
    font-size: 13px;
    color: var(--ant-color-text);
    font-weight: 500;
`

/** evaluator 判定理由：斜体 + 浅底，前缀标注来源 */
const Reason = styled.div`
    font-size: 12px;
    color: var(--ant-color-text-secondary);
    font-style: italic;
    background: var(--ant-color-fill-quaternary);
    padding: 6px 8px;
    border-radius: 4px;
    &::before {
        content: 'evaluator · ';
        font-weight: 600;
        font-style: normal;
        color: var(--ant-color-text-tertiary);
    }
`

const Stats = styled.div`
    display: flex;
    gap: 12px;
    font-size: 11px;
    color: var(--ant-color-text-tertiary);
`

export interface GoalDetailProps {
    goal: GoalStatus
    sessionId: string
    onClear: (sid: string, fields: ClearRuntimeStateField[]) => Promise<void>
}

/**
 * Goal 详情（吊顶展开态浮层内容）。
 *
 * 状态徽标 + 条件文案 + evaluator 理由（可选）+ 统计（轮次/耗时/tokens，按可用性渲染）+
 * 清理按钮。数据源 session.runtimeState.goalStatus。
 */
export function GoalDetail({ goal, sessionId, onClear }: GoalDetailProps) {
    return (
        <Card $met={goal.met}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <StatusBadge $met={goal.met}>{goal.met ? '✓ 达成' : '◎ active'}</StatusBadge>
            </div>
            <Condition>{goal.condition}</Condition>
            {goal.reason ? <Reason>{goal.reason}</Reason> : null}
            <Stats>
                {typeof goal.iterations === 'number' ? (
                    <span>
                        轮次 <strong>{goal.iterations}</strong>
                    </span>
                ) : null}
                {typeof goal.durationMs === 'number' ? (
                    <span>
                        耗时 <strong>{Math.round(goal.durationMs / 1000)}s</strong>
                    </span>
                ) : null}
                {typeof goal.tokens === 'number' ? (
                    <span>
                        <strong>{goal.tokens}</strong> tokens
                    </span>
                ) : null}
            </Stats>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <ClearStateButton sessionId={sessionId} clearField="goalStatus" onClear={onClear} />
            </div>
        </Card>
    )
}
