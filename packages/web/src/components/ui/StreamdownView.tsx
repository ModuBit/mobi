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

/**
 * Streamdown 渲染视图（新栈，flag 开启时由 Markdown 分发挂载）
 *
 * ticket 01 为最小接入：无插件（LaTeX/slash/mention/脚注等在后续 ticket 逐项补齐）、
 * 无动画定制（ticket 08）、代码块走 Streamdown 默认 controls/主题（ticket 07 收口）。
 * 输入内容已由 Markdown 统一经 useStreamingContent 平滑层揭示（双栈共用），此处
 * 只负责把「揭示进行中」绑定到 isAnimating（后续动画插件依赖该信号进出管线）。
 *
 * linkSafety 关闭：与现状对齐（外链直接新标签页打开，不做拦截确认），决策见 spec。
 */

import { memo, type CSSProperties } from 'react'
import { Streamdown } from 'streamdown'

/** linkSafety 配置（模块级常量保持稳定引用，不因每帧重建打破 Streamdown 内部 memo） */
const LINK_SAFETY_OFF = { enabled: false } as const

export interface StreamdownViewProps {
    /** Markdown 文本内容（已过平滑层） */
    content: string
    /** 揭示进行中（平滑层缓冲未收敛 / 流式未结束），驱动 Streamdown 流式语义 */
    isAnimating?: boolean
    /** 追加到容器的外部类名（透传自 Markdown.className） */
    className?: string
    /** 容器内联样式（透传自 Markdown.style） */
    style?: CSSProperties
}

/** 新栈容器类：streamdown.css 的设计令牌作用域 + 后续排版映射的挂点（ticket 02） */
export const STREAMDOWN_CONTAINER_CLASS = 'streamdown-md'

export const StreamdownView = memo(function StreamdownView({
    content,
    isAnimating,
    className,
    style,
}: StreamdownViewProps) {
    return (
        <div
            className={[STREAMDOWN_CONTAINER_CLASS, className].filter(Boolean).join(' ')}
            style={{ maxWidth: '100%', ...style }}
        >
            <Streamdown mode="streaming" isAnimating={isAnimating} linkSafety={LINK_SAFETY_OFF}>
                {content}
            </Streamdown>
        </div>
    )
})

export default StreamdownView
