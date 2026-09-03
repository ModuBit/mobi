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
 * Claude Code 内置 output style。
 *
 * 注意：style 名大小写以 CC init 上报值为准（sdkMetadata.outputStyle 当前为
 * "default" 小写，其余四个为驼峰原名）——上报值即 Options.outputStyle 应传值。
 * 常量按 CC /config 菜单 2026-09-03 实抄定稿。
 */

// 顺序对齐 CC /config 官方菜单序
export const OUTPUT_STYLES = ['default', 'proactive', 'concise', 'explanatory', 'learning'] as const
export type OutputStyle = (typeof OUTPUT_STYLES)[number]

export const OUTPUT_STYLE_LABELS: Record<OutputStyle, string> = {
    default: 'Default',
    proactive: 'Proactive',
    concise: 'Concise',
    explanatory: 'Explanatory',
    learning: 'Learning'
}

/** 下拉选项：内置项 description 走 i18n（web 侧按 key 取），custom 形态本期预留不产出 */
export type OutputStyleOption = {
    style: string
    label: string
    /** i18n key 后缀（web: `composer.outputStyleDescriptions.<key>`）；自定义 style 无 */
    descriptionKey?: OutputStyle
}

export function isBuiltinOutputStyle(style: string): style is OutputStyle {
    return (OUTPUT_STYLES as readonly string[]).includes(style)
}
