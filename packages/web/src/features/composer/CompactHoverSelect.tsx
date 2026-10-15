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
 * composer 参数区共用的紧凑选择器（权限模式 / 模型 / output style / agent）。
 * 底座是 registry 件 morph-select（uiarc，见 registry.json）；本壳职责：
 * ① 选项 API 归一——调用方维持 `onChange(value)` 单参形态，morph 的
 *    `(value, option)` 双参在壳内吞掉；② composer 固定形态——向上展开
 *    （composer 贴屏幕底）、模型列表 >8 项自动出搜索（morph searchable auto）；
 * ③ 满宽变体（NewSessionPage 698493a5）——morph 面板宽 = max(trigger,
 *    min(panelWidth, 100vw-2rem))，panelWidth 顶到上限即满宽减 2rem 边距；
 * ④ effort-popover 全局样式注入（antd Popover 形态归此单点，不随调用方复制）。
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { MorphSelect, type MorphSelectItem } from '@/ui/shadcn/morph-select/morph-select'

export interface CompactHoverSelectOption {
    value: string
    label: string
    /** 双行描述（morph description 槽，12px 弱化行，参与搜索） */
    description?: string
    /** 列表项与触发器选中态的前置图标 */
    icon?: ReactNode
    /** 行尾嵌套交互入口（如模型行的 effort 子菜单）；点击不触发选中已由 morph 收口 */
    trailing?: ReactNode
    disabled?: boolean
}

export interface CompactHoverSelectProps {
    /** 可访问名（morph label 必填）：composer 各选择器传 i18n 文案 */
    label: string
    options: CompactHoverSelectOption[]
    value?: string | null
    onChange?: (value: string) => void
    disabled?: boolean
    /** 加载中：选项未就绪，触发器一并禁用（原 antd loading 的最小承接） */
    loading?: boolean
    /** 触发器内 value 前的静态缀（effort 圆点等） */
    prefix?: ReactNode
    /** 悬停提示（wrapper title） */
    title?: string
    /** 收起态仅图标 + chevron */
    iconOnly?: boolean
    /** 满宽变体：面板宽顶到视口上限（NewSessionPage 模型下拉，698493a5） */
    mobileFullWidth?: boolean
}

// effort 子菜单的 antd Popover 样式注入（单点）：收窄内衬、去箭头、行 hover 高亮
let effortStyleInjected = false
function useEffortPopoverStyle() {
    useEffect(() => {
        if (effortStyleInjected || typeof document === 'undefined') return
        const style = document.createElement('style')
        style.textContent = `
.effort-popover .ant-popover-container { padding: 4px 0 !important; }
.effort-popover .ant-popover-arrow { display: none !important; }
.effort-popover .effort-item:hover { background: var(--ant-color-bg-text-hover) !important; }
.effort-popover .effort-arrow { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; min-height: 24px; border-radius: var(--radius-square); }
.effort-popover .effort-arrow:hover { background: var(--ant-color-bg-text-hover); }
`
        document.head.appendChild(style)
        effortStyleInjected = true
    }, [])
}

export function CompactHoverSelect({
    label,
    options,
    value,
    onChange,
    disabled,
    loading,
    prefix,
    title,
    iconOnly,
    mobileFullWidth,
}: CompactHoverSelectProps) {
    useEffortPopoverStyle()
    // CompactHoverSelectOption 与 MorphSelectOption 结构同构（value/label/description/icon/trailing/disabled）
    const items: MorphSelectItem[] = options
    return (
        <span title={title}>
            <MorphSelect
                label={label}
                items={items}
                value={value ?? null}
                // morph 回调是 (value, option) 双参，壳内吞掉 option，调用方维持 onChange(value) 单参形态
                onValueChange={(v) => onChange?.(v)}
                disabled={disabled || loading}
                prefix={prefix}
                iconOnly={iconOnly}
                // composer 全部贴屏幕底：默认向上展开
                direction="up"
                panelWidth={mobileFullWidth ? 9999 : undefined}
            />
        </span>
    )
}
