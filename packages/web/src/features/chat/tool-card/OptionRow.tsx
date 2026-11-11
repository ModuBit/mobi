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

import { type CSSProperties, type ReactNode, type KeyboardEvent } from 'react'
import { theme as antTheme } from 'antd'
// uiarc 自管件（antd Checkbox/Radio 迁移）：多选 mark 用 Checkbox；单选 mark 用 RadioCards 导出的
// RadioIndicator（同一指示器单源，卡片组件内部同款）
import { Checkbox } from '@/ui/shadcn/checkbox/checkbox'
import { RadioIndicator } from '@/ui/shadcn/radio-cards/radio-cards'
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
    /** 完成态元信息标记（如「(custom answer)」）；始终渲染，不受 title 相等守卫影响 */
    subtitle?: ReactNode
    preview?: string | null
    /** 未提供时按钮不响应点击（用于只读展示态） */
    onClick?: () => void
    children?: ReactNode
    'data-testid'?: string
}

/**
 * 共享选项行 —— AskUserQuestion 的交互态（Footer）与完成态（View）共用，
 * 根除两处样式漂移。触控目标移动端 44px / 桌面 40px。
 *
 * 选中态由 uiarc Checkbox（多选）/ uiarc RadioIndicator（单选）承载：填充方块 / 实心圆点 + 弹簧过渡，
 * 比线性图标切换更有确定感。mark 作纯视觉（pointerEvents none，点击穿透到本行 div），
 * 状态由外层受控。行内不再叠加背景染色 / 左色带，避免选中反馈堆叠显脏；
 * 仅留一条实色选中边框做轮廓反馈。
 *
 * 外层用 div[role=radio|checkbox]：button 内不能嵌 interactive content，
 * 用 radio/checkbox role 让屏幕阅读器正确播报 aria-checked 选中态；内部 mark aria-hidden 纯视觉。
 * 补 onKeyDown（Enter/Space）维持键盘可达性。
 */
export function OptionRow(props: OptionRowProps) {
    const { token } = antTheme.useToken()

    // 实色选中边框（替代过去淡色 accentBorder + 背景染色 + 左色带的三重堆叠）
    const accent = props.tone === 'completed' ? token.colorSuccess : token.colorPrimary

    const showDescription = Boolean(props.description && props.description !== props.title)

    // mark 外壳：纯视觉（aria-hidden + pointerEvents none，点击穿透到本行 div）。
    // 多选 = uiarc Checkbox / 单选 = uiarc RadioIndicator，状态由外层受控。
    // 完成态选中色局部覆盖 CSS 变量为成功色——CSS 变量沿 DOM 继承，外壳一处注入对
    // 两分支统一生效（ConfigProvider 的 token 覆盖只影响 antd 子树，uiarc 走 CSS 变量）
    const markStyle = {
        pointerEvents: 'none',
        ...(props.tone === 'completed' ? {
            '--control-on': token.colorSuccess,
            '--control-glyph': token.colorSuccess,
        } : null),
    } as CSSProperties

    // 标题 + 描述组合：如有 preview 则外层包 OptionPreview（眼睛图标 + Popover）
    // 注：标题固定 colorText（非强调色）——选中态的强调由 antd mark + 实色边框承载，
    // 答案文字本身不再额外染色。
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
            {/* subtitle：完成态的元信息标记（如「(custom answer)」），始终渲染、不受 title 相等守卫影响 */}
            {props.subtitle ? (
                <div style={{ marginTop: 2, fontSize: 12, color: token.colorTextSecondary, wordBreak: 'break-word' }}>
                    {props.subtitle}
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
        borderRadius: 'var(--radius-control-sm)',
        textAlign: 'left',
        fontSize: 14,
        // 选中：实色细边框做轮廓反馈；未选中：中性淡边框。不再染整行背景
        border: `1px solid ${props.checked ? accent : token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        // completed 为只读展示态（非"输入锁定"），不压低透明度；
        // interactive 的 disabled 用于提交中锁定，保留半透明反馈
        opacity: props.disabled && props.tone !== 'completed' ? 0.5 : 1,
        transition: 'border-color .15s',
    }

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (props.disabled) return
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            props.onClick?.()
        }
    }

    return (
        <div
            role={props.mode === 'multi' ? 'checkbox' : 'radio'}
            tabIndex={props.disabled ? -1 : 0}
            aria-checked={props.checked}
            aria-disabled={props.disabled}
            data-testid={props['data-testid']}
            data-selected={props.checked ? 'true' : 'false'}
            data-tone={props.tone}
            onClick={props.disabled ? undefined : props.onClick}
            onKeyDown={onKeyDown}
            style={baseStyle}
        >
            <span
                aria-hidden="true"
                style={{ flexShrink: 0, marginTop: 2, display: 'flex', alignItems: 'center', ...markStyle }}
            >
                {props.mode === 'multi'
                    ? <Checkbox checked={props.checked} tabIndex={-1} />
                    : <RadioIndicator checked={props.checked} />}
            </span>
            <span style={{ minWidth: 0, flex: 1 }}>
                {content}
                {props.children}
            </span>
        </div>
    )
}
