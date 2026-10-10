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
 * mode=app 宿主注入的 `--mobi-*` 主题变量词汇（generative-ui 票 05 引入，2026-10-10
 * 架构评审候选 3 收口单源）。
 *
 * 同一变量清单此前有三份手工同步：web 侧 CSS 生成（sandboxAppHost）、session 侧 prompt
 * 教学（生成脚本 APP_DETAIL_RULES）、visualize skill 散文。漂移的后果不对称——渲染侧
 * 少个变量只是样式缺角，**prompt 侧多教一个不存在的变量会让模型照抄产出坏 app**。
 *
 * 此表是三方 pivot：web 按它 exhaustive 生成 CSS（漏键编译红）、session 生成脚本按它
 * 拼教学句、契约测试按它双向核对（注入 ⊇ 表；教学 ⊆ 表）。值的来源（antd token 映射 /
 * 系统字体栈字面量）留在 web——本表只管**名字**这个会漂移的维度。
 */

/** 按语义分组的变量清单（组序即 web 侧 CSS 生成顺序） */
export const MOBI_THEME_VARS = {
    /** 主题通道元信息（非调色板，教学不列） */
    meta: ['--mobi-color-scheme'],
    /** 表面 */
    surfaces: ['--mobi-bg', '--mobi-bg-base', '--mobi-bg-elevated', '--mobi-bg-layout'],
    /** 前景文本 */
    foregrounds: ['--mobi-fg', '--mobi-fg-secondary', '--mobi-fg-muted'],
    /** 语义强调色 */
    accents: ['--mobi-primary', '--mobi-success', '--mobi-warning', '--mobi-danger'],
    /** 边框与圆角 */
    borders: ['--mobi-border', '--mobi-border-muted', '--mobi-radius'],
    /** 字体栈 */
    typography: ['--mobi-font-body', '--mobi-font-mono'],
} as const

/** 扁平全集（分组展开，顺序与 CSS 生成顺序一致） */
export const MOBI_THEME_VAR_LIST = Object.values(MOBI_THEME_VARS).flat() as readonly string[]

export type MobiThemeVar = (typeof MOBI_THEME_VAR_LIST)[number]

/** 教学列举用：非调色板变量（meta 组）不进 prompt 文本 */
export const MOBI_THEME_PALETTE_VARS = MOBI_THEME_VAR_LIST.filter((v) => !MOBI_THEME_VARS.meta.includes(v as never))
