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
 * 回应批注 directive 的 React 侧（模式同 FootnoteComponents）：Context 携带批注数据
 * （触发本轮回复的 user 消息 quote blocks，按 index 对齐），Marker 组件渲染「引用 N」
 * 上标按钮（与用户消息侧「N 条引用」同一词汇，编号与 <quote index> 同源）——
 * hover 看引用原文与评论、点击定位跳转源消息。
 *
 * 无批注数据可解析（伪造/越界索引、非批注场景的字面量）时按 directive 原文降级呈现。
 */

import { createContext, useContext, type FC, type ReactNode } from 'react'
import { theme } from 'antd'
import { useTranslation } from 'react-i18next'
import { Quote } from 'lucide-react'
import type { ComponentProps } from '@ant-design/x-markdown'
import type { UserQuoteBlock } from '@mobi/shared'
import { AppTooltip } from './AppTooltip'

/** 批注数据 Context：quotes 按 directive index 对齐（位置 i = 注释 i+1），由 agent-text 渲染分支注入 */
interface QuoteAnnotations {
    quotes: readonly UserQuoteBlock[]
    onLocate: (messageId: string) => void
}

export const QuoteAnnotationsContext = createContext<QuoteAnnotations | undefined>(undefined)

/** tooltip 内容：引用原文 + 用户评论（有则显示）。antd Tooltip 恒深色浮层，评论
 *  色不能取主题 text token（light 主题下深灰落在深色浮层上不可读，2026-09-23 验收），
 *  用浮层前景的固定透明度分层 */
function AnnotationTooltipContent({ quote }: { quote: UserQuoteBlock }) {
    return (
        <div style={{ maxWidth: 320, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            <div>{quote.excerpt}</div>
            {quote.comment && (
                <div style={{ marginTop: 4, color: 'rgba(255, 255, 255, 0.65)' }}>{quote.comment}</div>
            )}
        </div>
    )
}

/** 「引用 N」上标标记（默认色 tag + 引用 icon）：外层 inline-block 盒高锁死 1em 且基线
 *  对齐——tag 视觉溢出不参与行高，首行与其余行基线严格一致 */
export const QuoteDirectiveMarker: FC<ComponentProps<{ 'data-index'?: string }>> = ({ 'data-index': dataIndex, children }) => {
    const { token } = theme.useToken()
    const { t } = useTranslation()
    const annotations = useContext(QuoteAnnotationsContext)
    const index = parseInt(dataIndex ?? '0', 10)
    const quote = annotations?.quotes[index - 1]

    // 无批注数据：诚实降级为 directive 原文（renderer 塞进 children 的原始字面量）
    if (!annotations || !quote) {
        return <span style={{ fontSize: '0.85em', color: token.colorTextTertiary }}>{children}</span>
    }

    const marker = (
        <sup
            className="quote-directive"
            data-testid={`quote-annotation-${index}`}
            onClick={(e) => {
                e.stopPropagation()
                annotations.onLocate(quote.messageId)
            }}
            style={{
                // 零行盒影响方案（2026-09-23 三轮验收收敛）：整体纯 inline + line-height:0——
                // inline 非替换元素的行盒贡献只由 line-height 决定；仿 tag 的 border/background
                // 是纯视觉溢出、icon 绝对定位脱流，首行与其余行基线严格一致
                position: 'relative',
                lineHeight: 0,
                fontSize: '0.72em',
                margin: '0 2px',
                cursor: 'pointer',
                userSelect: 'none',
                whiteSpace: 'nowrap',
            }}
        >
            {/* 引用 icon 与用户消息侧「N 条引用」chip 同款（lucide Quote）；svg 是替换元素
                （高度参与行盒），必须绝对定位脱流 */}
            <Quote size={10} style={{ position: 'absolute', left: 3, top: 0 }} />
            <span style={{
                display: 'inline',
                // 仿 antd 默认 Tag（border + 弱填充背景）；inline 元素的垂直 border/padding
                // 是纯视觉，不参与行盒
                border: '1px solid var(--ant-color-border)',
                borderRadius: 8,
                padding: '1px 6px 1px 15px',
                background: 'var(--ant-color-fill-quaternary)',
            }}>
                {t('chat.annotationMarker', { count: index })}
            </span>
        </sup>
    )

    return (
        <AppTooltip title={<AnnotationTooltipContent quote={quote} />} mouseEnterDelay={0.4}>
            {marker}
        </AppTooltip>
    )
}

/** Context 供应壳：quotes 缺省给空数组（组件按越界降级），避免调用方判空 */
export function QuoteAnnotationsProvider({ quotes, onLocate, children }: {
    quotes?: readonly UserQuoteBlock[]
    onLocate: (messageId: string) => void
    children: ReactNode
}) {
    return (
        <QuoteAnnotationsContext.Provider value={{ quotes: quotes ?? [], onLocate }}>
            {children}
        </QuoteAnnotationsContext.Provider>
    )
}
