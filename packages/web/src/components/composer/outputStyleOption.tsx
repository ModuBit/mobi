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
 * output style 下拉选项构建与渲染。
 *
 * 渲染策略与 permissionModeOption 同款（名称 + secondary 描述双行），但不共用组件——
 * 数据结构（label 为 CC 英文原名不走 i18n、descriptionKey 走 i18n 键名空间）
 * 与 tone 语义（output style 无 tone 着色）不同。
 * 自定义 style（init 上报的非内置名）只渲染原名、无描述行（SDK 不透传 frontmatter）。
 */

import type { ReactNode } from 'react'
import { OUTPUT_STYLES, OUTPUT_STYLE_LABELS } from '@mobi/shared'

export interface OutputStyleSelectOption {
    value: string
    /** CC 英文原名（不翻译），用于选中态紧凑显示 */
    label: string
    /** i18n 键后缀（composer.outputStyleDescriptions.<key>）；非内置项无 */
    descriptionKey?: string
}

/** 构建内置 output style 下拉选项（顺序对齐 CC /config 官方菜单序） */
export function buildOutputStyleSelectOptions(): OutputStyleSelectOption[] {
    return OUTPUT_STYLES.map((style) => ({
        value: style,
        label: OUTPUT_STYLE_LABELS[style],
        descriptionKey: style,
    }))
}

/**
 * 渲染下拉项：名称 + 描述（secondary 12px，自动换行）
 *
 * 用于 antd Select 的 optionRender。入参放宽为 unknown —— antd v6 的
 * optionRender 传入的是 FlattenOptionData 包装类型，原始对象在 .data，
 * 兼容直接对象与 .data 包装两种结构。
 * 调用方可能在 options 里追加自定义 style 项（init 上报的非内置名），
 * options 未命中时按 value 兜底：内置名取 CC 原名，其余原名直出、无描述行。
 */
export function renderOutputStyleOption(
    option: unknown,
    options: OutputStyleSelectOption[],
    t: (key: string) => string,
): ReactNode {
    const raw = (option ?? {}) as { value?: string; data?: { value?: string } }
    const source = raw.data ?? raw
    const value = source.value || raw.value || 'default'
    const known = options.find((o) => o.value === value)
    const label = known?.label ?? OUTPUT_STYLE_LABELS[value as keyof typeof OUTPUT_STYLE_LABELS] ?? value
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
            <span style={{ fontWeight: 500 }}>{label}</span>
            {known?.descriptionKey && (
                <span style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--ant-color-text-secondary)', whiteSpace: 'normal' }}>
                    {t(`composer.outputStyleDescriptions.${known.descriptionKey}`)}
                </span>
            )}
        </div>
    )
}
