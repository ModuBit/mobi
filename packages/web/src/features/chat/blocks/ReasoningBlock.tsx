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

import { useState, memo, useRef } from 'react'
import { Think } from '@ant-design/x'
import ThinkIcon from '@ant-design/x/es/think/icons/think'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@/ui/base/markdown/Markdown'
import { CrossfadeText } from '@/ui/base/motion/CrossfadeText'
import { StatusIcon } from '@/ui/base/display/toolIcons'
import { useSmoothStickBottom } from '@/features/chat/useSmoothStickBottom'

/** 思考过程渲染 */
export const ReasoningBlock = memo(function ReasoningBlock({ text, thinking, isStreaming, durationMs }: {
    text: string
    thinking: boolean
    isStreaming?: boolean
    /** thinking 块流式生成耗时（ms）；仅 remote 打点注入，local/历史消息为 undefined → 不展示时长 */
    durationMs?: number
}) {
    const { t } = useTranslation()
    // 展开权只归用户：任何位置、任何阶段都默认收起（散落块与折叠组内一致），
    // 展开后也不因 thinking 结束或相邻块变化而自动开合——想看的自己点开
    const [expanded, setExpanded] = useState(false)
    const contentRef = useRef<HTMLDivElement>(null)
    // 高度信号源：内容盒被 maxHeight:200 clamp 固定后 border-box 恒定、RO 静默，
    // 流式增长无人跟随——观测不受上限约束的内层元素（思考多了就不贴底的根因）
    const innerRef = useRef<HTMLDivElement>(null)

    // 流式期间内容盒缓动贴底（替代 scrollTop = scrollHeight 硬跳——换行时
    // 内容瞬跳一行，快输出下「一跳一跳」）；RO 观测内层内容高度，逐字揭示的
    // 每帧增高都续追（揭示进度不经过 props，text 快照粒度跟不上）。
    // 收起时不启用：内容盒不可见，追赶纯属浪费（hook 的 enabled 语义即「收起态 false」）
    useSmoothStickBottom(contentRef, !!isStreaming && expanded, { observeRef: innerRef })

    // 完成态：耗时 ≥ 100ms 展示「思考完成 · X.X秒」；
    // < 100ms（interleaved thinking 的极短片段，toFixed 得 0.0s 无意义）/ 无耗时（local/历史消息）退化为「思考完成」
    const showDuration = durationMs != null && durationMs >= 100
    const thoughtTitle = showDuration
        ? t('chat.thoughtDuration', { secs: (durationMs! / 1000).toFixed(1) })
        : t('chat.thought')

    return (
        <Think
            icon={
                <StatusIcon state={thinking ? 'running' : 'completed'} style={{ alignItems: 'center' }}>
                    <ThinkIcon />
                </StatusIcon>
            }
            title={
                // 「思考中」扫光走自家 shimmer（CrossfadeText），不用 antdx Think 的 blink
                <CrossfadeText text={thinking ? t('chat.thinking') : thoughtTitle} shimmer={thinking} />
            }
            expanded={expanded}
            onExpand={setExpanded}
        >
            <div ref={contentRef} style={{ maxHeight: 200, overflowY: 'auto' }}>
                <div ref={innerRef}>
                    <Markdown content={text} streaming={isStreaming} />
                </div>
            </div>
        </Think>
    )
})
