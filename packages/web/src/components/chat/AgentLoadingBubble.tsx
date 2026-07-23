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

interface AgentLoadingBubbleProps {
    agentId: string
    status: AgentStatus
    /** 外部指定的运行起始时间戳（毫秒），如 tool.startedAt；无值时使用组件 mount 时间 */
    startedAt?: number
}

export function AgentLoadingBubble({ agentId, status, startedAt }: AgentLoadingBubbleProps) {
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

    return (
        <div role="status" aria-label={`${agentId} 正在运行`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StatusStateIcon state={status} style={{ width: 8, height: 8 }} />
            <BlinkText blinking color={CLAUDE_ORANGE} aria-live="polite" style={{ fontSize: 13, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <ScrambleText text={vibingMsg} previousText={prevMsg} speed={40} />
            </BlinkText>
            <span aria-hidden="true" style={{ color: token.colorTextTertiary, fontSize: 12, marginLeft: 'auto' }}>
                {elapsedTime}
            </span>
        </div>
    )
}