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
 * mode=app 宿主注入（generative-ui 票 05/06）：沙箱 app 档的「宿主 → app / app → 宿主」
 * 两侧注入通道单文件（web 侧的宿主通道拓扑，对应 daemon 侧同概念）。
 *
 * 宿主 → app（票 05）：`--mobi-*` 主题变量调色板。iframe load 后注入，宿主亮/暗切换时
 * 原地更新（不重载 iframe，不打断 app 运行态）；变量名清单同时是 openui skill 教学
 * 文本的依据，改名须同步生成脚本。
 *
 * app → 宿主（票 06）入向 bridge：宿主注入 `window.MobiApp.issueNewTurn(text)` 全局
 * 对象，内部经 postMessage 发宿主；宿主侧经四道校验后才进消息受理 intake（与 openui
 * 回路②同一单点）：
 *   1. 来源 frame：event.source 必须是宿主自己渲染的那个 sandbox iframe（组件层收口）
 *   2. 白名单：仅 type 'mobi-app' + action 'issueNewTurn'（本模块 parseAppBridgeMessage）
 *   3. schema：text 限 string / trim 非空 / 限长（超限整体拒绝，不截断——截断会静默改语义）
 *   4. 限流：app 内脚本自动调用与用户点击在宿主侧不可区分，最小间隔把「脚本刷消息」
 *      的伤害面压到「最多每秒一条」，配合气泡上的来源标记（sentFrom）供用户辨识
 *
 * 威胁评估与残余风险见 ADR 0007 增补（docs/adr/0007）。PREVIEW_CSP 的
 * script-src 带 'unsafe-inline'（产物页行内脚本是常规形态），宿主注入的脚本可执行；
 * connect-src 'none' 不影响 postMessage（非网络请求）。
 */

import { shadcnLightToken, shadcnDarkToken } from '@/core/config/theme/tokens'
import { MOBI_THEME_VAR_LIST, type MobiThemeVar } from '@mobi/shared'

/** bridge 消息的 type 白名单值（唯一） */
export const APP_BRIDGE_MSG_TYPE = 'mobi-app'
/** bridge 消息的 action 白名单值（唯一；openLink 等第二通道需求出现再加，见票 06 记录） */
export const APP_BRIDGE_ACTION = 'issueNewTurn'
/** text 上限：app 状态摘要不该长过一条人写的消息 */
export const APP_BRIDGE_TEXT_MAX = 4000
/** 限流最小间隔（ms）：同一 frame 两次 issueNewTurn 之间至少隔这么久 */
export const APP_BRIDGE_MIN_INTERVAL_MS = 1000

/**
 * 校验宿主收到的 postMessage data（纯函数）。非白名单 type/action、text 非 string、
 * trim 后空或超限 → null（静默丢弃，不回错——app 无法处理也没有必要知道）。
 */
export function parseAppBridgeMessage(data: unknown): { text: string } | null {
    if (typeof data !== 'object' || data === null) return null
    const obj = data as Record<string, unknown>
    if (obj.type !== APP_BRIDGE_MSG_TYPE) return null
    if (obj.action !== APP_BRIDGE_ACTION) return null
    if (typeof obj.text !== 'string') return null
    const text = obj.text.trim()
    if (text.length === 0 || text.length > APP_BRIDGE_TEXT_MAX) return null
    return { text }
}

const APP_BRIDGE_SCRIPT_ID = 'mobi-app-bridge'

/**
 * 注入 app 侧 API 脚本（幂等）：`window.MobiApp.issueNewTurn(text)` → postMessage
 * 宿主。targetOrigin 用 iframe 自身的 origin（allow-same-origin 下即 mobi origin，
 * 不放宽到 '*'——即便消息被第三方 frame 截到也只是发给宿主的请求，宿主侧来源校验
 * 才是权威防线，但收紧无成本）。跨域/未就绪静默跳过。
 */
export function injectAppBridgeScript(doc: Document | null | undefined): void {
    try {
        if (!doc?.head || doc.getElementById(APP_BRIDGE_SCRIPT_ID)) return
        const script = doc.createElement('script')
        script.id = APP_BRIDGE_SCRIPT_ID
        script.textContent = `(function () {
  if (window.MobiApp) return;
  window.MobiApp = {
    issueNewTurn: function (text) {
      if (typeof text !== 'string') return;
      parent.postMessage({ type: ${JSON.stringify(APP_BRIDGE_MSG_TYPE)}, action: ${JSON.stringify(APP_BRIDGE_ACTION)}, text: text }, location.origin);
    }
  };
})();`
        doc.head.appendChild(script)
    } catch {
        // contentDocument 不可达（理论不可达：同源沙箱）——不注入
    }
}

/**
 * 限流器工厂（可测：注入时钟）。返回的判定函数通过放行一条、间隔内的后续全拒。
 * 每 frame 组件实例一个限流器——不同 app 的消息互不影响。
 */
export function createAppBridgeRateLimiter(now: () => number = () => Date.now()): () => boolean {
    let lastAt = -Infinity
    return () => {
        const at = now()
        if (at - lastAt < APP_BRIDGE_MIN_INTERVAL_MS) return false
        lastAt = at
        return true
    }
}

// ---------------------------------------------------------------------------
// 宿主 → app：--mobi-* 主题变量注入（票 05）
// ---------------------------------------------------------------------------

/** 双档 token 的最小投影类型（变量值来源只消费其中的色板/圆角键） */
type MobiThemeToken = Pick<
    typeof shadcnLightToken,
    | 'colorBgBase' | 'colorBgContainer' | 'colorBgElevated' | 'colorBgLayout'
    | 'colorText' | 'colorTextSecondary' | 'colorTextTertiary'
    | 'colorPrimary' | 'colorSuccess' | 'colorWarning' | 'colorError'
    | 'colorBorder' | 'colorBorderSecondary' | 'borderRadius'
>

/**
 * 变量名 → 值来源（exhaustive：键集即 shared MOBI_THEME_VAR_LIST——shared 表加变量
 * 漏配此处来源，编译即红；反向多配也红）。值来源三类：token 字段 / 派生（圆角补 px）/
 * 字面量（字体系统栈——宿主 var(--font-body) 在 iframe 里解析不到）。
 */
const MOBI_VAR_SOURCES: Record<MobiThemeVar, (t: MobiThemeToken, mode: 'light' | 'dark') => string> = {
    '--mobi-color-scheme': (_t, mode) => mode,
    '--mobi-bg': (t) => t.colorBgContainer,
    '--mobi-bg-base': (t) => t.colorBgBase,
    '--mobi-bg-elevated': (t) => t.colorBgElevated,
    '--mobi-bg-layout': (t) => t.colorBgLayout,
    '--mobi-fg': (t) => t.colorText,
    '--mobi-fg-secondary': (t) => t.colorTextSecondary,
    '--mobi-fg-muted': (t) => t.colorTextTertiary,
    '--mobi-primary': (t) => t.colorPrimary,
    '--mobi-success': (t) => t.colorSuccess,
    '--mobi-warning': (t) => t.colorWarning,
    '--mobi-danger': (t) => t.colorError,
    '--mobi-border': (t) => t.colorBorder,
    '--mobi-border-muted': (t) => t.colorBorderSecondary,
    '--mobi-radius': (t) => `${t.borderRadius}px`,
    '--mobi-font-body': () => '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    '--mobi-font-mono': () => 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
}

/**
 * 构建 `--mobi-*` 主题 CSS（mode=app 注入；对齐 ChatGPT --viz-* 三招：主题变量 /
 * base styles / 尺寸自适应——尺寸自适应归调用方 chrome，这里只管前两招）。
 * 变量清单单一来源在 shared MOBI_THEME_VARS（prompt 教学与契约测试同 pivot）。
 *
 * 覆盖语义（app 自带样式永远赢）：
 * - 变量声明在 `:root`——是宿主→app 的输入通道（app 消费取色，不重定义）；
 * - color-scheme 与 base 样式（body 的 margin/背景/前景/字体）走 `:where()`（特异性 0），
 *   app 自身任何选择器（哪怕裸 `body`）都能覆盖。
 */
export function buildMobiThemeCss(mode: 'light' | 'dark'): string {
    const t: MobiThemeToken = mode === 'dark' ? shadcnDarkToken : shadcnLightToken
    const declarations = MOBI_THEME_VAR_LIST.map((name) => `  ${name}: ${MOBI_VAR_SOURCES[name](t, mode)};`)
    return [
        `:where(:root) { color-scheme: ${mode}; }`,
        ':root {',
        ...declarations,
        '}',
        ':where(body) { margin: 0; background: var(--mobi-bg); color: var(--mobi-fg); font-family: var(--mobi-font-body); }',
    ].join('\n')
}

const MOBI_THEME_STYLE_ID = 'mobi-app-theme'

/** 两档 CSS 的模块级缓存：输出只有 light/dark 两个确定值，主题切换/重渲染零重建 */
const MOBI_THEME_CSS: Record<'light' | 'dark', string> = {
    light: buildMobiThemeCss('light'),
    dark: buildMobiThemeCss('dark'),
}

/**
 * 注入/更新 `--mobi-*` 主题样式（幂等）：已存在则原地更新 textContent——宿主切换
 * 亮/暗时 app 即时跟随，无需重载 iframe。跨域/未就绪静默跳过。
 */
export function injectMobiThemeStyle(doc: Document | null | undefined, mode: 'light' | 'dark'): void {
    try {
        if (!doc?.head) return
        let style = doc.getElementById(MOBI_THEME_STYLE_ID)
        if (!style) {
            style = doc.createElement('style')
            style.id = MOBI_THEME_STYLE_ID
            doc.head.appendChild(style)
        }
        style.textContent = MOBI_THEME_CSS[mode]
    } catch {
        // contentDocument 不可达（理论不可达：同源沙箱）——不注入
    }
}
