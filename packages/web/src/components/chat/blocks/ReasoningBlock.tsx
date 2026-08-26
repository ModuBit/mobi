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

import { useState, useEffect, memo, useRef } from 'react'
import { Think } from '@ant-design/x'
import ThinkIcon from '@ant-design/x/es/think/icons/think'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@/components/ui/Markdown'
import { StatusStateIcon } from '@/components/tool-card/toolIcons'
import { useSmoothStickBottom } from '@/components/chat/useSmoothStickBottom'

/** 思考过程渲染 */
export const ReasoningBlock = memo(function ReasoningBlock({ text, thinking, isStreaming, durationMs }: {
    text: string
    thinking: boolean
    isStreaming?: boolean
    /** thinking 块流式生成耗时（ms）；仅 remote 打点注入，local/历史消息为 undefined → 不展示时长 */
    durationMs?: number
}) {
    const { t } = useTranslation()
    const [expanded, setExpanded] = useState(thinking)
    const contentRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!thinking) setExpanded(false)
    }, [thinking])

    // 流式期间内容盒缓动贴底（替代 scrollTop = scrollHeight 硬跳——换行时
    // 内容瞬跳一行，快输出下「一跳一跳」）；RO 观测内容盒高度，逐字揭示的
    // 每帧增高都续追（揭示进度不经过 props，text 快照粒度跟不上）
    useSmoothStickBottom(contentRef, !!isStreaming)

    // 完成态：耗时 ≥ 100ms 展示「思考完成 · X.X秒」；
    // < 100ms（interleaved thinking 的极短片段，toFixed 得 0.0s 无意义）/ 无耗时（local/历史消息）退化为「思考完成」
    const showDuration = durationMs != null && durationMs >= 100
    const thoughtTitle = showDuration
        ? t('chat.thoughtDuration', { secs: (durationMs! / 1000).toFixed(1) })
        : t('chat.thought')

    return (
        <Think
            icon={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <StatusStateIcon state={thinking ? 'running' : 'completed'} />
                    <ThinkIcon />
                </span>
            }
            title={thinking ? t('chat.thinking') : thoughtTitle}
            blink={thinking}
            expanded={expanded}
            onExpand={setExpanded}
        >
            <div ref={contentRef} style={{ maxHeight: 200, overflowY: 'auto' }}>
                <Markdown content={text} streaming={isStreaming} />
            </div>
        </Think>
    )
})
