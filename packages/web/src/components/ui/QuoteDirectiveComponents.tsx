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
 * （触发本轮回复的 user 消息 quote blocks，按 index 对齐），Marker 组件渲染「注释 N」
 * 上标按钮——hover 看引用原文与评论、点击定位跳转源消息。
 *
 * 无批注数据可解析（伪造/越界索引、非批注场景的字面量）时按 directive 原文降级呈现。
 */

import { createContext, useContext, type FC, type ReactNode } from 'react'
import { Tag, theme } from 'antd'
import { useTranslation } from 'react-i18next'
import type { ComponentProps } from '@ant-design/x-markdown'
import type { UserQuoteBlock } from '@mobi/shared'
import { AppTooltip } from './AppTooltip'

/** 批注数据 Context：quotes 按 directive index 对齐（位置 i = 注释 i+1），由 agent-text 渲染分支注入 */
interface QuoteAnnotations {
    quotes: readonly UserQuoteBlock[]
    onLocate: (messageId: string) => void
}

export const QuoteAnnotationsContext = createContext<QuoteAnnotations | undefined>(undefined)

/** tooltip 内容：引用原文 + 用户评论（有则显示），评论是用户自己的话提一级灰 */
function AnnotationTooltipContent({ quote }: { quote: UserQuoteBlock }) {
    const { token } = theme.useToken()
    return (
        <div style={{ maxWidth: 320, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            <div>{quote.excerpt}</div>
            {quote.comment && (
                <div style={{ marginTop: 4, color: token.colorTextSecondary }}>{quote.comment}</div>
            )}
        </div>
    )
}

/** 「注释 N」上标按钮（脚注锚点样式，对齐 FootnoteRef 的 tag 语言） */
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

    const button = (
        <sup
            className="quote-directive"
            data-testid={`quote-annotation-${index}`}
            onClick={(e) => {
                e.stopPropagation()
                annotations.onLocate(quote.messageId)
            }}
        >
            <Tag color="blue" style={{
                padding: '0 0.3em',
                marginLeft: '0.15em',
                lineHeight: '1.2em',
                cursor: 'pointer',
                textDecoration: 'none',
                userSelect: 'none',
            }}>
                {t('chat.annotationMarker', { count: index })}
            </Tag>
        </sup>
    )

    return (
        <AppTooltip title={<AnnotationTooltipContent quote={quote} />} mouseEnterDelay={0.4}>
            {button}
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
