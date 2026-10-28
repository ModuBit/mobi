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
 * composer 参数区共用的紧凑选择器（权限模式 / output style / agent）。
 * 底座是 registry 件 morph-select（uiarc，见 registry.json）；本壳职责：
 * ① 选项 API 归一——调用方维持 `onChange(value)` 单参形态，morph 的
 *    `(value, option)` 双参在壳内吞掉；② composer 固定形态——展开方向/视口钳制
 *    交 morph auto 决策（展开内容恒在视窗内）、关闭 >8 项自动搜索。
 *
 * 模型选择已迁到 `ModelSettingsSelect`（pill → 面板），本壳不再承载模型行。
 */

import type { ReactNode } from 'react'
import { MorphSelect, type MorphSelectItem } from '@/ui/base/interactive/morph-select/MorphSelect'

export interface CompactHoverSelectOption {
    value: string
    label: string
    /** 双行描述（morph description 槽，12px 弱化行，参与搜索） */
    description?: string
    /** 列表项与触发器选中态的前置图标 */
    icon?: ReactNode
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
}: CompactHoverSelectProps) {
    // CompactHoverSelectOption 与 MorphSelectOption 结构同构（value/label/description/icon/disabled）
    const items: MorphSelectItem[] = options
    // display:flex：span 若是 inline 级（含 inline-flex），在包裹 div 的行盒里按基线排版，
    // 基线下方的 descender 空隙会把包裹撑高、pill 顶在顶部——相对同行控件偏移 ~2.7px
    return (
        <span title={title} style={{ display: 'flex', alignItems: 'center' }}>
            <MorphSelect
                label={label}
                // label 仅作可访问名（morph 上游默认把 label 可见渲染在控件上方，composer 不要）
                hideLabel
                items={items}
                value={value ?? null}
                // morph 回调是 (value, option) 双参，壳内吞掉 option，调用方维持 onChange(value) 单参形态
                onValueChange={(v) => onChange?.(v)}
                disabled={disabled || loading}
                prefix={prefix}
                iconOnly={iconOnly}
                // 模型列表 >8 项时 morph 默认出搜索（searchable auto）——composer 不需要：
                // 展开即全列表滚动选取，typeahead 键盘检索仍可用
                searchable={false}
            />
        </span>
    )
}
