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

import {
    NEUTRAL_DARK,
    NEUTRAL_LIGHT,
    RADIUS_TIERS,
    SEMANTIC_DARK,
    SEMANTIC_LIGHT,
    type NeutralKey,
    shadcnLightToken,
    shadcnDarkToken,
} from './tokens'

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
    // 以下为 shadcn/arc 源码组件实际消费、而标准 shadcn 变量集未覆盖的 token
    // （弹层的强/弱描边、次级文字、面板圆角、两级投影）
    ['--border-strong', 'colorTextQuaternary'],
    ['--border-subtle', 'colorBorderSecondary'],
    ['--text-secondary', 'colorTextSecondary'],
    ['--radius-lg', 'borderRadiusLG'],
    ['--shadow-resting', 'boxShadowSecondary'],
    ['--shadow-floating', 'boxShadow'],
]

/**
 * CSS 过渡时长的投影：antd cssVar 只投颜色 / 圆角 / 阴影，**不产出 motion 变量**——
 * `--ant-motion-*` 只在 antd 组件子树内可解析（浏览器实测 :root 全空），弹层 portal 到
 * body 后更取不到，故由本模块单源供给。值取 antd 默认主题 token（motionDurationFast /
 * motionDurationMid / motionEaseOut / motionEaseInOut），registry 组件据此不必自带
 * 第二套缓动语言（DESIGN.md「Motion」章：组件禁止硬编码毫秒数与 cubic-bezier 字面量）。
 */
const MOTION_VARS: ReadonlyArray<readonly [string, string]> = [
    ['--mobi-duration-fast', '0.1s'],
    ['--mobi-duration-mid', '0.2s'],
    ['--mobi-ease-out', 'cubic-bezier(0.215, 0.61, 0.355, 1)'],
    ['--mobi-ease-in-out', 'cubic-bezier(0.645, 0.045, 0.355, 1)'],
]

/**
 * 圆角档位的 CSS 投影：**角色名即变量名**（DESIGN.md「Shapes」的档位表逐档对应）。
 * 组件取档一律引这些变量，不再写死数值——antd 主题 token 只覆盖得了 antd 组件，
 * 自绘件（styled-component / 模块 CSS / 弹层）够不着，全靠这一组变量接住。
 * 与 antd 四个槽位的对应关系见 tokens.ts 的 RADIUS_TIERS 注释。
 */
const RADIUS_VARS: ReadonlyArray<readonly [string, number]> = [
    ['--radius-square', RADIUS_TIERS.square],
    ['--radius-icon', RADIUS_TIERS.icon],
    ['--radius-control-sm', RADIUS_TIERS.controlSm],
    ['--radius-control', RADIUS_TIERS.control],
    ['--radius-panel', RADIUS_TIERS.panel],
    ['--radius-surface', RADIUS_TIERS.surface],
    ['--radius-pill', RADIUS_TIERS.pill],
]

/**
 * 中性阶的 CSS 投影：**角色名即变量名**（DESIGN.md「Colors」的中性阶逐档对应）。
 * antd 的 `--ant-color-*` 只在组件子树内可解析，`src/styles/*.css` 与自绘件够不着，
 * 全靠这一组变量接住——此前它们各自抄了一份十六进制（markdown.css 一处就抄了 39 个），
 * 配色一改就漏一片。
 */
const NEUTRAL_VARS: ReadonlyArray<readonly [string, NeutralKey]> = [
    ['--mobi-elevated', 'elevated'],
    ['--mobi-paper', 'container'],
    ['--mobi-canvas', 'canvas'],
    ['--mobi-hairline', 'hairline'],
    ['--mobi-hairline-strong', 'hairlineStrong'],
    ['--mobi-hover', 'hover'],
    ['--mobi-selected', 'selected'],
    ['--mobi-pressed', 'pressed'],
    ['--mobi-ink', 'ink'],
    ['--mobi-ink-secondary', 'inkSecondary'],
    ['--mobi-ink-tertiary', 'inkTertiary'],
    ['--mobi-ink-quaternary', 'inkQuaternary'],
    ['--mobi-primary', 'primary'],
]

/** 语义色的 CSS 投影（双档同族，只有明度不同）——自绘件与样式表的取色入口 */
const SEMANTIC_VARS: ReadonlyArray<readonly [string, 'success' | 'warning' | 'danger']> = [
    ['--mobi-success', 'success'],
    ['--mobi-warning', 'warning'],
    ['--mobi-danger', 'danger'],
]

/**
 * 固定深色舞台（反色气泡 / 登录页徽章等「浅色主题里的深色块」）的取色入口：
 * 一律取净墨档且**不随主题切换**——它们本来就是深底，跟着主题翻色会自相矛盾。
 * 因与主题无关，取值直接写进表里（对照 NEUTRAL_VARS 存的是档名，需运行时按档取）。
 */
const STAGE_VARS: ReadonlyArray<readonly [string, string]> = [
    ['--mobi-stage-canvas', NEUTRAL_DARK.canvas],
    ['--mobi-stage-elevated', NEUTRAL_DARK.elevated],
    ['--mobi-stage-ink', NEUTRAL_DARK.ink],
    ['--mobi-stage-ink-secondary', NEUTRAL_DARK.inkSecondary],
    ['--mobi-stage-ink-tertiary', NEUTRAL_DARK.inkTertiary],
    ['--mobi-stage-ink-quaternary', NEUTRAL_DARK.inkQuaternary],
    // 舞台内的强调色同样是净墨档的语义色（不随主题切换）：登录页终端面板的提示绿
    ['--mobi-stage-success', SEMANTIC_DARK.success],
]

/** 注入样式节点的 id（ThemeProvider 挂载，幂等原地更新） */
export const SHADCN_TOKENS_STYLE_ID = 'mobi-shadcn-tokens'

/**
 * shadcn/arc 弹层的统一 z-index 基线（spec D6）：antd 弹层 z 从 1000 起（mask/wrap），
 * shadcn 生态默认 z-50 会在空间重叠处被 antd 弹层整层盖住（票 03 实测）。
 * arc 组件源码经 var(--mobi-z-overlay) 消费此值；缺省回落 50 维持生态默认。
 */
const Z_OVERLAY = 1080

/** 把「变量名 → 取值」表渲染成 CSS 行（缩进与分号的格式只此一处，新增一类变量不必再抄一遍） */
function renderVars<T>(entries: ReadonlyArray<readonly [string, T]>, render: (value: T) => string): string[] {
    return entries.map(([cssVar, value]) => `  ${cssVar}: ${render(value)};`)
}

/** 从双档 token 构建 shadcn 命名变量 CSS：light 挂 :root、dark 挂 .dark */
export function buildShadcnThemeCss(mode: Mode): string {
    const token: Token = mode === 'dark' ? shadcnDarkToken : shadcnLightToken
    const selector = mode === 'dark' ? '.dark' : ':root'
    const ramp = mode === 'dark' ? NEUTRAL_DARK : NEUTRAL_LIGHT
    const semantic = mode === 'dark' ? SEMANTIC_DARK : SEMANTIC_LIGHT
    return [
        `${selector} {`,
        ...renderVars(SHADCN_VAR_MAPPINGS, (tokenKey) => {
            const value = token[tokenKey]
            // borderRadius 是数字（px 语义），其余为色值字符串
            return typeof value === 'number' ? `${value}px` : value
        }),
        ...renderVars(NEUTRAL_VARS, (key) => ramp[key]),
        ...renderVars(SEMANTIC_VARS, (key) => semantic[key]),
        ...renderVars(STAGE_VARS, (value) => value),
        ...renderVars(RADIUS_VARS, (value) => `${value}px`),
        ...renderVars(MOTION_VARS, (value) => value),
        `  --mobi-z-overlay: ${Z_OVERLAY};`,
        '}',
    ].join('\n')
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
