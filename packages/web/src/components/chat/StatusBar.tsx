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

import type { AgentStatus } from '@/components/pixel-avatar/types'
import type { GoalStatus } from '@mobi/shared'
import type { ClearRuntimeStateField } from '@/components/composer/ClearStateButton'
import { AgentLoadingBubble } from './AgentLoadingBubble'
import { GoalBadge } from './GoalBadge'

interface StatusBarProps {
    /** Agent 标识（AgentLoadingBubble aria-label 用） */
    agentId: string
    /** Agent 运行状态（驱动 StatusDot 颜色/节奏）；running 时缺省则不渲染 loading */
    status?: AgentStatus
    /** 是否正在运行 */
    running: boolean
    /** goal 状态（有值时渲染徽标） */
    goal?: GoalStatus | null
    /** sessionId（goal 清理用，与 onClearGoal 同时传入） */
    sessionId?: string
    /** goal 清理回调（与 sessionId 同时传入时徽标带清理按钮） */
    onClearGoal?: (sid: string, fields: ClearRuntimeStateField[]) => Promise<void>
}

/**
 * 状态栏：composer 输入框上方一行，承载 goal 徽标与 loading 指示。
 *
 * 渲染规则：有 goal 或 running（含 status）时才渲染，否则返回 null 不占布局高度。
 * 内容横向并列：左侧 goal 徽标（有 goal 时）+ 右侧 loading 气泡（running && status 时）。
 * width: fit-content 让整行收缩到内容宽度，避免计时被 marginLeft:auto 推到 composer 最右。
 */
export function StatusBar({ agentId, status, running, goal, sessionId, onClearGoal }: StatusBarProps) {
    const showGoal = goal != null
    const showLoading = running && Boolean(status)
    if (!showGoal && !showLoading) return null

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: showGoal && showLoading ? 8 : 0,
                padding: '4px 8px',
                width: 'fit-content',
            }}
        >
            {showGoal ? (
                <GoalBadge
                    goal={goal!}
                    sessionId={sessionId}
                    onClear={onClearGoal}
                />
            ) : null}
            {showLoading ? <AgentLoadingBubble agentId={agentId} status={status!} /> : null}
        </div>
    )
}
