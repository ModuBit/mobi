/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License at
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useEffect, useRef, useState } from 'react'
import { theme } from 'antd'
import { useElapsedSeconds } from './useElapsedSeconds'
import { ScrambleText } from './ScrambleText'
import { formatElapsedTime } from '@/core/utils/timeFormat'
import { StatusStateIcon } from '@/components/tool-card/toolIcons'
import type { AgentStatus } from '@/components/pixel-avatar/types'
import { VIBING_MESSAGES } from '@/components/pixel-avatar/vibingMessages'
import { BlinkText } from '@/components/ui/BlinkText'

/** Claude 品牌橙色 */
const CLAUDE_ORANGE = '#D97757'

/** vibing 消息轮换间隔（秒） */
const VIBING_INTERVAL = 5

/**
 * 静默告警阈值（毫秒）：距最近一次消息活动超过该值时，loading 文案从
 * vibing 轮换切换为「仍在等待响应」。区分「在干活」vs「在干等」——正常
 * 长任务期间消息/工具事件持续到达；上游挂死（如代理连接建立但不返 token，
 * API_TIMEOUT_MS 又长达数十分钟）则完全静默，vibing 动词照样轮换会造成
 * 「一直在干活」的假象（见 docs/pending.md #34）。阈值取 120s：实测
 * /code-review high 这类重任务正常也需 ~85s 才出第一个事件，留出余量。
 */
const STALL_WARN_MS = 120_000

interface AgentLoadingBubbleProps {
    agentId: string
    status: AgentStatus
    /** 外部指定的运行起始时间戳（毫秒），如 tool.startedAt；无值时使用组件 mount 时间 */
    startedAt?: number
    /**
     * 最近一次消息活动时间戳（毫秒）。传入且静默超过 {@link STALL_WARN_MS} 时
     * 切换为等待响应提示（挂死可观测）。不传则不启用检测——sidechain 卡片等
     * 无活动时间来源的场景保持原行为。
     */
    lastActivityAt?: number
}

export function AgentLoadingBubble({ agentId, status, startedAt, lastActivityAt }: AgentLoadingBubbleProps) {
    const { token } = theme.useToken()
    const mountTimeRef = useRef(Date.now())
    // 首词随机偏移量，避免首个 vibingMsg 总是 "accomplishing"
    const initialOffset = useRef(Math.floor(Math.random() * VIBING_MESSAGES.length))
    // prevMsg 用 useState 替代 useRef，StrictMode 下 React 正确丢弃第一轮 state 更新
    const [prevMsg, setPrevMsg] = useState(
        VIBING_MESSAGES[initialOffset.current].toLowerCase() + '…'
    )
    const effectiveStartedAt = startedAt ?? mountTimeRef.current

    const elapsed = useElapsedSeconds(effectiveStartedAt)

    // 静默计时：距最近消息活动的秒数（复用每秒 tick 的计时器；无来源时以 startedAt 兜底恒不告警）
    const stallElapsed = useElapsedSeconds(lastActivityAt ?? effectiveStartedAt)

    // 每隔 VIBING_INTERVAL 秒随机切换 vibing 消息
    const vibingIndex = elapsed <= 0
        ? initialOffset.current
        : (initialOffset.current + Math.floor((elapsed - 1) / VIBING_INTERVAL)) % VIBING_MESSAGES.length
    const vibingMsg = VIBING_MESSAGES[vibingIndex].toLowerCase() + '…'

    // vibingMsg 变化时更新 prevMsg，供下一次 ScrambleText 过渡动画
    useEffect(() => {
        setPrevMsg(vibingMsg)
    }, [vibingMsg])

    const elapsedTime = formatElapsedTime(effectiveStartedAt, effectiveStartedAt + elapsed * 1000)

    // awaiting_auth：等待用户审批，文本/aria-label 切到「等待审批」，不轮换 vibing 动词
    const isAwaitingAuth = status === 'awaiting_auth'
    // 静默告警：距最近消息活动超阈值（挂死可观测）。审批等待优先——那不是模型无响应
    const stalled = !isAwaitingAuth
        && lastActivityAt !== undefined
        && (stallElapsed * 1000) >= STALL_WARN_MS
    const labelText = isAwaitingAuth
        ? 'awaiting approval…'
        : stalled ? 'still waiting for response…' : vibingMsg
    const ariaLabel = isAwaitingAuth
        ? `${agentId} 等待审批`
        : stalled ? `${agentId} 长时间无响应` : `${agentId} 正在运行`

    return (
        <div role="status" aria-label={ariaLabel} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StatusStateIcon state={status} style={{ width: 8, height: 8 }} />
            <BlinkText blinking color={stalled ? token.colorWarning : CLAUDE_ORANGE} aria-live="polite" style={{ fontSize: 13, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <ScrambleText text={labelText} previousText={prevMsg} speed={40} />
            </BlinkText>
            <span aria-hidden="true" style={{ color: token.colorTextTertiary, fontSize: 12, marginLeft: 'auto' }}>
                {elapsedTime}
            </span>
        </div>
    )
}