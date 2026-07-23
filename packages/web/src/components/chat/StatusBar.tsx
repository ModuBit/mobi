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
import { AgentLoadingBubble } from './AgentLoadingBubble'

interface StatusBarProps {
    /** Agent 标识（AgentLoadingBubble aria-label 用） */
    agentId: string
    /** Agent 运行状态（驱动 StatusDot 颜色/节奏）；缺省时不渲染 */
    status?: AgentStatus
    /** 是否正在运行：false 时不渲染 */
    running: boolean
}

/**
 * 状态栏：running 时在输入框上方独立一行展示 loading 内容（StatusDot + vibing 文字 + 计时）。
 * 替代原先 push 到消息列表末尾的 loading 气泡，使 loading 指示固定可见、不随消息流滚动。
 * 非 running（或 status 缺省）时返回 null，不占布局高度。
 */
export function StatusBar({ agentId, status, running }: StatusBarProps) {
    if (!running || !status) return null
    // width: fit-content 让整行收缩到内容宽度，避免计时被 marginLeft:auto 推到 composer 最右
    return (
        <div style={{ padding: '4px 8px', width: 'fit-content' }}>
            <AgentLoadingBubble agentId={agentId} status={status} />
        </div>
    )
}
