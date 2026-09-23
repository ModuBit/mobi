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
import { Tag, theme } from 'antd'
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

/** 「引用 N」上标 tag 标记（蓝色 tag，与 FootnoteRef 的 tag 语言一致）：baseline 显式
 *  对齐 + line-height:0 + 外层 0.72em 使 tag 高度小于正文 ascent——首行行盒不被撑高
 *  （带框 Tag 撑高 line box 致首行基线错位，2026-09-23 验收） */
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
                // 显式 baseline 对齐（sup 的 UA super 会让标记悬空显「没对齐」，2026-09-23 验收）；
                // line-height 归零使 sup 的文字盒不参与行高计算——Tag 高度 ≈1.2×0.72em 小于
                // 正文 ascent，不会再撑高首行
                verticalAlign: 'baseline',
                lineHeight: 0,
                fontSize: '0.72em',
                margin: '0 2px',
            }}
        >
            {/* 引用 icon 与用户消息侧「N 条引用」chip 同款（lucide Quote） */}
            <Tag color="blue" style={{
                padding: '0 0.4em',
                // 1.2em（相对 0.72em 外层）≈ 0.86 正文 em：控制在正文 ascent 之内，行盒不被撑高
                lineHeight: '1.2em',
                cursor: 'pointer',
                textDecoration: 'none',
                userSelect: 'none',
            }}>
                <Quote size={10} style={{ verticalAlign: '-0.1em', marginRight: 2 }} />
                {t('chat.annotationMarker', { count: index })}
            </Tag>
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
