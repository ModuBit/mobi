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
 * shadcn 命名主题变量的单源投影（shadcn 底座票 02）：从 tokens.ts 双档纯数据生成
 * `--background` 系变量，供 shadcn/uiarc 源码组件消费；Tailwind v4 的 @theme inline
 * 在 index.css 把它们映射为 utility（bg-background 等）。范式照抄 SandboxHtmlFrame
 * 的 buildMobiThemeCss（token→CSS 变量投影先例）。新增变量只改 SHADCN_VAR_MAPPINGS 一处。
 */

import { shadcnLightToken, shadcnDarkToken } from './tokens'

type Mode = 'light' | 'dark'
type Token = typeof shadcnLightToken

/** [shadcn 变量名, token 键]，两档同构；radius 值为数字需拼 px（见 buildShadcnThemeCss） */
const SHADCN_VAR_MAPPINGS: ReadonlyArray<readonly [string, keyof Token]> = [
    ['--background', 'colorBgBase'],
    ['--foreground', 'colorText'],
    ['--card', 'colorBgElevated'],
    ['--card-foreground', 'colorText'],
    ['--popover', 'colorBgElevated'],
    ['--popover-foreground', 'colorText'],
    ['--primary', 'colorPrimary'],
    ['--primary-foreground', 'colorPrimaryText'],
    ['--secondary', 'colorFillTertiary'],
    ['--secondary-foreground', 'colorText'],
    ['--muted', 'colorFillQuaternary'],
    ['--muted-foreground', 'colorTextTertiary'],
    ['--accent', 'colorBgTextHover'],
    ['--accent-foreground', 'colorText'],
    ['--destructive', 'colorError'],
    ['--border', 'colorBorder'],
    ['--input', 'colorBorder'],
    ['--ring', 'colorPrimary'],
    ['--radius', 'borderRadius'],
]

/** 注入样式节点的 id（ThemeProvider 挂载，幂等原地更新） */
export const SHADCN_TOKENS_STYLE_ID = 'mobi-shadcn-tokens'

/**
 * shadcn/arc 弹层的统一 z-index 基线（spec D6）：antd 弹层 z 从 1000 起（mask/wrap），
 * shadcn 生态默认 z-50 会在空间重叠处被 antd 弹层整层盖住（票 03 实测）。
 * arc 组件源码经 var(--mobi-z-overlay) 消费此值；缺省回落 50 维持生态默认。
 */
const Z_OVERLAY = 1080

/** 从双档 token 构建 shadcn 命名变量 CSS：light 挂 :root、dark 挂 .dark */
export function buildShadcnThemeCss(mode: Mode): string {
    const token: Token = mode === 'dark' ? shadcnDarkToken : shadcnLightToken
    const selector = mode === 'dark' ? '.dark' : ':root'
    const lines = SHADCN_VAR_MAPPINGS.map(([cssVar, tokenKey]) => {
        const value = token[tokenKey]
        // borderRadius 是数字（px 语义），其余为色值字符串
        const rendered = typeof value === 'number' ? `${value}px` : value
        return `  ${cssVar}: ${rendered};`
    })
    return [`${selector} {`, ...lines, `  --mobi-z-overlay: ${Z_OVERLAY};`, '}'].join('\n')
}

/** 注入/更新 shadcn 变量样式（幂等）：已存在则原地更新 textContent，切档不重建节点 */
export function injectShadcnThemeCss(doc: Document, mode: Mode): void {
    const existing = doc.getElementById(SHADCN_TOKENS_STYLE_ID)
    if (existing) {
        existing.textContent = buildShadcnThemeCss(mode)
        return
    }
    const style = doc.createElement('style')
    style.id = SHADCN_TOKENS_STYLE_ID
    style.textContent = buildShadcnThemeCss(mode)
    doc.head.appendChild(style)
}
