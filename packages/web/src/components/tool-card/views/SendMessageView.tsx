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

import { useEffect, useRef, useState } from 'react'
import { theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { ArrowRight, ChevronDown, Mail } from 'lucide-react'
import { getField, isObject } from '@mobi/shared'
import type { ToolViewProps } from '@/components/tool-card/views/_all'
import { extractTextFromResult } from '@/components/tool-card/views/_results'

const { useToken } = antTheme

/** 预览态正文钳制行数 */
const PREVIEW_LINE_CLAMP = 5
/** 钳制高度（px）：行高 1.6 × 12px 字号 × 行数，供溢出检测比较 */
const PREVIEW_CLAMP_HEIGHT = Math.round(12 * 1.6 * PREVIEW_LINE_CLAMP)
/**
 * 首帧溢出预估阈值（对齐 CollapsibleUserMessage 的保守哲学）：
 * 宁可少量短消息首帧误判为「可展开」（测量后双向修正），也不让长消息先全展开再收起闪烁。
 */
function estimateContentClipped(content: string | null | undefined): boolean {
    if (!content) return false
    return content.split('\n').length > PREVIEW_LINE_CLAMP || content.length > 200
}

/** 从 result 中解析出结构化对象 */
function parseResultObject(result: unknown): Record<string, unknown> | null {
    const text = extractTextFromResult(result)
    if (!text) return null
    try {
        const parsed = JSON.parse(text)
        return isObject(parsed) ? parsed : null
    } catch {
        return null
    }
}

/** 从 input 解析收件人 */
function getRecipient(input: unknown): string | null {
    if (!isObject(input)) return null
    return getField<string>(input, 'to') ?? getField<string>(input, 'recipient') ?? null
}

/** 从 input 解析摘要 */
function getSummary(input: unknown): string | null {
    if (!isObject(input)) return null
    return getField<string>(input, 'summary') ?? null
}

/** 从 input 解析正文：优先 input.message（完整正文）；input.content 是信封层截断后的投影（尾部带 …），仅作降级 */
function getContent(input: unknown): string | null {
    if (!isObject(input)) return null
    const message = getField<string>(input, 'message')
    if (message) {
        // 尝试解析 JSON，如果是结构化消息则提取 type 展示
        try {
            const parsed = JSON.parse(message)
            if (isObject(parsed)) {
                const type = getField<string>(parsed, 'type')
                if (type) return `[${type}] ${getField<string>(parsed, 'reason') ?? ''}`
            }
        } catch { /* not JSON, use raw */ }
        return message
    }
    const content = getField<string>(input, 'content')
    return content ?? null
}

/**
 * SendMessage 工具视图（预览 + Drawer 完整视图共用）
 * 邮件风格：发件人 → 收件人，摘要为标题，正文为内容。
 *
 * - 预览（chat 列表内）：正文超 5 行时折叠，点击「展开」原位展开完整正文（卡片自管溢出，
 *   knownTools 配 previewMaxHeight: MAX_SAFE_INTEGER 让外层 OverflowContainer 不介入）
 * - 完整（SendMessageFullView，Drawer 内）：正文不钳制，直接展示完整消息
 */
export function SendMessageView(props: ToolViewProps) {
    return <MailCardView {...props} full={false} />
}

/** SendMessage Drawer 完整视图：同一邮件卡，正文不钳制 */
export function SendMessageFullView(props: ToolViewProps) {
    return <MailCardView {...props} full={true} />
}

function MailCardView({ full, block }: ToolViewProps & { full: boolean }) {
    const { token } = useToken()
    const { t } = useTranslation()
    const { input, result, state } = block.tool

    // 检查 tool_use_error（is_error: true 时 result 可能是字符串或 content array）
    if (state === 'error') {
        const resultText = extractTextFromResult(result)
        // 尝试提取 <tool_use_error> 标签
        let errorMsg = 'Send failed'
        if (resultText) {
            const match = resultText.match(/<tool_use_error>(.*?)<\/tool_use_error>/s)
            errorMsg = match ? match[1].trim() : resultText
        }
        return (
            <div style={{
                display: 'flex',
                gap: 12,
                padding: '10px 12px',
                borderRadius: 6,
                border: `1px solid ${token.colorErrorBorder}`,
                background: token.colorErrorBg,
            }}>
                <div style={{
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: token.colorErrorBg,
                    color: token.colorError,
                }}>
                    <Mail size={18} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: token.colorError }}>
                        {getRecipient(input) ? `To: ${getRecipient(input)}` : 'Send Message'}
                    </div>
                    <div style={{ fontSize: 12, color: token.colorError, lineHeight: 1.5 }}>
                        {errorMsg}
                    </div>
                </div>
            </div>
        )
    }

    const resultObj = parseResultObject(result)
    const isSuccess = resultObj ? getField<boolean>(resultObj, 'success') === true : state === 'completed'

    // 从 result.routing 获取更准确的 sender/target
    const routing = resultObj ? getField<Record<string, unknown>>(resultObj, 'routing') : null
    const sender = routing ? getField<string>(routing, 'sender') : null
    const target = routing
        ? (getField<string>(routing, 'target') ?? undefined)?.replace(/^@/, '') ?? null
        : null

    // fallback 到 input
    const from = sender ?? 'agent'
    const to = target ?? getRecipient(input) ?? 'unknown'
    const summary = (routing ? getField<string>(routing, 'summary') : null) ?? getSummary(input)
    const content = getContent(input) ?? (routing ? getField<string>(routing, 'content') : null)

    // ── 预览态原位展开（Drawer 完整视图不参与）──
    // 首帧按文本长度估值渲染即折叠（避免长消息先全展开再收起闪烁）；
    // effect + ResizeObserver 用真实高度双向修正（估值误判的短消息回到无展开态）。
    // clientHeight = 0（jsdom / 容器隐藏）不可测量，保留首帧估值。
    const [expanded, setExpanded] = useState(false)
    const [clippable, setClippable] = useState(() => estimateContentClipped(content))
    const contentInnerRef = useRef<HTMLSpanElement>(null)

    useEffect(() => {
        const el = contentInnerRef.current
        if (!el) return
        const measure = () => {
            const outer = el.parentElement
            if (!outer || outer.clientHeight === 0) return
            setClippable(el.scrollHeight > PREVIEW_CLAMP_HEIGHT + 1)
        }
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(el)
        return () => ro.disconnect()
    }, [content])

    const collapsed = !full && clippable && !expanded

    return (
        <div style={{
            display: 'flex',
            gap: 12,
            padding: '10px 12px',
            borderRadius: 6,
            border: `1px solid ${isSuccess ? token.colorSuccessBorder : token.colorBorderSecondary}`,
            background: token.colorBgLayout,
        }}>
            {/* 左侧：信封图标 */}
            <div style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'center',
                width: 36,
                height: 36,
                borderRadius: 8,
                background: isSuccess ? token.colorSuccessBg : token.colorPrimaryBg,
                color: isSuccess ? token.colorSuccess : token.colorPrimary,
                marginTop: 2,
            }}>
                <Mail size={18} />
            </div>

            {/* 右侧：邮件内容 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
                {/* 发件人 → 收件人 */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    color: token.colorTextSecondary,
                }}>
                    <span style={{
                        fontWeight: 500,
                        color: token.colorText,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                    }}>
                        {from}
                    </span>
                    <ArrowRight size={12} style={{ flexShrink: 0, color: token.colorTextQuaternary }} />
                    <span style={{
                        fontWeight: 500,
                        color: token.colorPrimary,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                    }}>
                        {to}
                    </span>
                </div>

                {/* 摘要 */}
                {summary ? (
                    <div style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: token.colorText,
                        lineHeight: 1.4,
                    }}>
                        {summary}
                    </div>
                ) : null}

                {/* 正文：折叠态钳 5 行 + 点击原位展开；完整视图 / 展开态不钳制 */}
                {content ? (
                    <div
                        {...(!full && clippable ? {
                            onClick: () => setExpanded(v => !v),
                            style: { cursor: 'pointer' },
                        } : {})}
                    >
                        <div style={{
                            fontSize: 12,
                            lineHeight: 1.6,
                            color: token.colorTextTertiary,
                            whiteSpace: 'pre-line',
                            overflow: 'hidden',
                            ...(collapsed ? {
                                display: '-webkit-box',
                                WebkitLineClamp: PREVIEW_LINE_CLAMP,
                                WebkitBoxOrient: 'vertical',
                            } : {}),
                        }}>
                            <span ref={contentInnerRef}>{content}</span>
                        </div>
                    </div>
                ) : null}

                {/* 展开/收起入口（仅预览态且正文超钳制行数时出现） */}
                {!full && clippable && (
                    <div
                        role="button"
                        aria-expanded={expanded}
                        onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 2,
                            alignSelf: 'flex-start',
                            fontSize: 12,
                            lineHeight: 1.5,
                            color: token.colorTextSecondary,
                            cursor: 'pointer',
                            transition: 'color 0.15s ease',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = token.colorPrimary }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = token.colorTextSecondary }}
                    >
                        {t(expanded ? 'chat.collapse' : 'chat.expand')}
                        <ChevronDown
                            size={12}
                            style={{
                                flexShrink: 0,
                                transition: 'transform 0.2s ease',
                                transform: expanded ? 'rotate(180deg)' : 'none',
                            }}
                        />
                    </div>
                )}
            </div>
        </div>
    )
}
