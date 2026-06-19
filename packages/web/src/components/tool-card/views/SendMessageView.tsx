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

import { theme as antTheme } from 'antd'
import { ArrowRight, Mail } from 'lucide-react'
import { getField, isObject } from '@mobi/shared'
import type { ToolViewProps } from '@/components/tool-card/views/_all'
import { extractTextFromResult } from '@/components/tool-card/views/_results'

const { useToken } = antTheme

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

/** 从 input 解析正文 */
function getContent(input: unknown): string | null {
    if (!isObject(input)) return null
    // message 可能是 JSON 字符串（如 shutdown_request），优先用 content
    const content = getField<string>(input, 'content')
    if (content) return content
    const message = getField<string>(input, 'message')
    if (!message) return null
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

/**
 * SendMessage 工具视图
 * 邮件风格：发件人 → 收件人，摘要为标题，正文为内容
 */
export function SendMessageView(props: ToolViewProps) {
    const { token } = useToken()
    const { input, result, state } = props.block.tool

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
    const content = (routing ? getField<string>(routing, 'content') : null) ?? getContent(input)

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

                {/* 正文预览 */}
                {content ? (
                    <div style={{
                        fontSize: 12,
                        lineHeight: 1.6,
                        color: token.colorTextTertiary,
                        whiteSpace: 'pre-line',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 5,
                        WebkitBoxOrient: 'vertical',
                    }}>
                        {content}
                    </div>
                ) : null}
            </div>
        </div>
    )
}
