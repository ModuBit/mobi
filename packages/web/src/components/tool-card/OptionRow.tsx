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

import type { CSSProperties, ReactNode } from 'react'
import { theme as antTheme } from 'antd'
import { Circle, CircleCheck, Square, SquareCheck } from 'lucide-react'
import { OptionPreview } from './OptionPreview'

export type OptionRowMode = 'single' | 'multi'
export type OptionRowTone = 'interactive' | 'completed'

type OptionRowProps = {
    checked: boolean
    mode: OptionRowMode
    disabled: boolean
    /** interactive: 主色调高亮；completed: 成功色调（已完成态） */
    tone: OptionRowTone
    title: string
    description?: string | null
    preview?: string | null
    /** 未提供时按钮不响应点击（用于只读展示态） */
    onClick?: () => void
    children?: ReactNode
    'data-testid'?: string
}

/**
 * 共享选项行 —— AskUserQuestion 的交互态（Footer）与完成态（View）共用，
 * 根除两处样式漂移。触控目标移动端 44px / 桌面 40px。
 */
export function OptionRow(props: OptionRowProps) {
    const { token } = antTheme.useToken()

    const accent = props.tone === 'completed' ? token.colorSuccess : token.colorPrimary
    const accentBg = props.tone === 'completed' ? token.colorSuccessBg : token.colorPrimaryBg
    const accentBorder = props.tone === 'completed' ? token.colorSuccessBorder : token.colorPrimaryBorder

    const showDescription = Boolean(props.description && props.description !== props.title)

    const markSize = 18
    const mark = props.mode === 'multi'
        ? (props.checked ? <SquareCheck size={markSize} /> : <Square size={markSize} />)
        : (props.checked ? <CircleCheck size={markSize} /> : <Circle size={markSize} />)

    // 标题 + 描述组合：如有 preview 则外层包 OptionPreview（眼睛图标 + Popover）
    const labelContent = (
        <>
            <div style={{ fontWeight: 500, color: token.colorText, wordBreak: 'break-word' }}>
                {props.title}
            </div>
            {showDescription ? (
                <div style={{ marginTop: 2, fontSize: 12, color: token.colorTextSecondary, wordBreak: 'break-word' }}>
                    {props.description}
                </div>
            ) : null}
        </>
    )
    const content = props.preview ? (
        <OptionPreview preview={props.preview}>{labelContent}</OptionPreview>
    ) : labelContent

    const baseStyle: CSSProperties = {
        position: 'relative',
        display: 'flex',
        width: '100%',
        alignItems: 'flex-start',
        gap: 10,
        minHeight: 44,
        padding: '10px 12px 10px 14px',
        borderRadius: 8,
        textAlign: 'left',
        fontSize: 14,
        border: `1px solid ${props.checked ? accentBorder : token.colorBorderSecondary}`,
        background: props.checked ? accentBg : token.colorBgContainer,
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        // completed 为只读展示态（非"输入锁定"），不压低透明度；
        // interactive 的 disabled 用于提交中锁定，保留半透明反馈
        opacity: props.disabled && props.tone !== 'completed' ? 0.5 : 1,
        transition: 'border-color .15s, background .15s',
    }

    return (
        <button
            type="button"
            data-testid={props['data-testid']}
            data-selected={props.checked ? 'true' : 'false'}
            data-tone={props.tone}
            onClick={props.onClick}
            disabled={props.disabled}
            style={baseStyle}
        >
            {props.checked ? (
                <span data-slot="bar" style={{
                    position: 'absolute', left: 0, top: 8, bottom: 8, width: 3,
                    borderRadius: 2, background: accent,
                }} />
            ) : null}
            <span style={{
                flexShrink: 0, marginTop: 1, display: 'flex',
                color: props.checked ? accent : token.colorTextQuaternary,
            }}>
                {mark}
            </span>
            <span style={{ minWidth: 0, flex: 1 }}>
                {content}
                {props.children}
            </span>
        </button>
    )
}
