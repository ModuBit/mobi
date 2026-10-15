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
 * output style 下拉选项构建、渲染与选择器组件收口。
 *
 * 渲染策略与 permissionModeOption 同款（名称 + secondary 描述双行），但不共用组件——
 * 数据结构（label 为 CC 英文原名不走 i18n、descriptionKey 走 i18n 键名空间）
 * 与 tone 语义（output style 无 tone 着色）不同。
 * 自定义 style（init 上报的非内置名）只渲染原名、无描述行（SDK 不透传 frontmatter）。
 */

import { LineStyle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { OUTPUT_STYLES, OUTPUT_STYLE_LABELS } from '@mobi/shared'
import { CompactHoverSelect } from './CompactHoverSelect'

export interface OutputStyleSelectOption {
    value: string
    /** CC 英文原名（不翻译），用于选中态紧凑显示 */
    label: string
    /** i18n 键后缀（composer.outputStyleDescriptions.<key>）；非内置项无 */
    descriptionKey?: string
    /** 描述行 i18n 完整键覆盖（如「跟随 CC 设置」项不对应任何内置 style，描述不走 Descriptions 命名空间） */
    descriptionOverrideKey?: string
}

/** 构建内置 output style 下拉选项（顺序对齐 CC /config 官方菜单序） */
export function buildOutputStyleSelectOptions(): OutputStyleSelectOption[] {
    return OUTPUT_STYLES.map((style) => ({
        value: style,
        label: OUTPUT_STYLE_LABELS[style],
        descriptionKey: style,
    }))
}

/** 解析描述行 i18n：override（完整键）优先，内置项走 Descriptions 后缀拼接 */
function resolveDescriptionI18nKey(option: OutputStyleSelectOption): string | undefined {
    return option.descriptionOverrideKey
        ?? (option.descriptionKey ? `composer.outputStyleDescriptions.${option.descriptionKey}` : undefined)
}

/** Output style 收起态图标（lucide LineStyle——样式线列表，直观对应对话风格）：单点维护 */
export function OutputStyleIcon() {
    return <LineStyle size={12} strokeWidth={2} className="opacity-55" />
}

export interface OutputStyleSelectProps {
    value: string
    options: OutputStyleSelectOption[]
    /** CompactHoverSelect 的 onChange 值形态是 unknown，调用方自行 String() 归一 */
    onChange: (value: unknown) => void
    disabled?: boolean
    loading?: boolean
    title?: string
    /** 收起态仅图标（可访问名转 srOnly）；下拉项详情恒完整渲染 */
    iconOnly?: boolean
}

/**
 * output style 紧凑选择器（纯展示）：CompactHoverSelect 装配收口点
 * （图标 + 描述双行 + 满宽语义，两处调用不再各自装配）。
 * 无确认弹窗 / 无 mutation——会话页（/clear 语义）用 OutputStyleSwitch 包确认后复用本组件，
 * 新建页（本地 state，无 /clear 语义）直接使用。
 */
export function OutputStyleSelect({ value, options, onChange, disabled, loading, title, iconOnly }: OutputStyleSelectProps) {
    const { t } = useTranslation()
    // ?? 而非 ||：'' 是「跟随 CC 设置」哨兵值，不能坍缩为 'default'
    const known = (v: string) => options.find((o) => o.value === v)
    const labelOf = (v: string) => known(v)?.label ?? OUTPUT_STYLE_LABELS[v as keyof typeof OUTPUT_STYLE_LABELS] ?? v
    const shellOptions = options.map((o) => {
        const key = resolveDescriptionI18nKey(o)
        return { value: o.value, label: labelOf(o.value), description: key ? t(key) : undefined, icon: <OutputStyleIcon /> }
    })
    return (
        <CompactHoverSelect
            label={t('composer.outputStyle')}
            value={value ?? null}
            options={shellOptions}
            onChange={onChange}
            disabled={disabled}
            loading={loading}
            title={title}
            iconOnly={iconOnly}
        />
    )
}
