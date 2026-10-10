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
 * 沙箱 HTML frame：serve-file → sandboxed iframe 的唯一机制收口（inspector 预览与
 * 聊天流产物 inline 是它的两个 chrome 形态，机制不许再写一份——曾在两边逐行重复
 * 且已漂移：滚动条主题注入只有一边有）。
 *
 * 机制面（本组件收口，调用方无需知道）：
 * - URL 经 buildServeFileUrl（relPath 按段编码，相对路径基准交给浏览器原生解析）
 * - sandbox allow-same-origin：iframe 与 mobi 同源，引用的 CSS/JS 子资源才不被 Chrome
 *   ORB 拦截；获得 mobi origin 能力后由服务端 PREVIEW_CSP 收窄到「只加载资源、不联网」
 *   （ADR 0007，安全规则在 daemon 单源，本组件不复刻）
 * - key 绑 meta 查询的 dataUpdatedAt：每次 refetch 都重建 iframe（不论 etag 是否变化）。
 *   用 dataUpdatedAt 而非 etag，是因为改引用的 CSS/JS 不会变 HTML 自身的 etag，但仍需
 *   重建才能拉到新引用资源；serve-file 已设 no-cache，重建时连带引用资源回源验证
 * - load 后注入滚动条主题（iframe 与宿主同源才可行，见 injectArtifactScrollbarStyle）
 * - injectTheme（generative-ui 票 05，mode=app 专用）：注入 `--mobi-*` 主题变量 + 低特异
 *   base 样式；宿主亮/暗切换时原地更新已注入的 style（不重载 iframe，不打断 app 运行态）
 * - onIssueNewTurn（generative-ui 票 06，mode=app 专用）：注入 app 侧 `MobiApp` API 并
 *   监听其 postMessage——四道校验（来源 frame / 白名单 / schema / 限流，收口在
 *   appBridge.ts）通过后回调；iframe 重建（key 变化）自动换新监听与限流器
 *
 * chrome 面（调用方决定）：尺寸、边框、圆角等经 style 透传；包装容器由调用方自理。
 */

import { useEffect, useRef, type CSSProperties } from 'react'
import { useFileMeta } from '@/core/data/hooks/queries/useFileTree'
import { buildServeFileUrl } from '@/core/utils/fileUrl'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'
import { shadcnLightToken, shadcnDarkToken } from '@/core/config/theme/tokens'
import { createAppBridgeRateLimiter, injectAppBridgeScript, parseAppBridgeMessage } from './appBridge'

/** 产物 iframe 的滚动条主题（主题中性：透明轨道 + 半透明灰 thumb，深浅色页面通用）。
 * 产物页面多未设 color-scheme，原生浅色滚动条压在深色页面上很突兀；iframe 与宿主
 * 同源（serve-file + allow-same-origin，ADR 0007），load 后注入这段样式即可覆盖。 */
const ARTIFACT_SCROLLBAR_STYLE = [
    '::-webkit-scrollbar { width: 8px; height: 8px; }',
    '::-webkit-scrollbar-track { background: transparent; }',
    '::-webkit-scrollbar-thumb { background: rgba(128, 128, 128, 0.45); border-radius: 4px; }',
    '::-webkit-scrollbar-thumb:hover { background: rgba(128, 128, 128, 0.65); }',
    '* { scrollbar-width: thin; scrollbar-color: rgba(128, 128, 128, 0.45) transparent; }',
].join('\n')

/** 向产物文档注入滚动条样式（幂等；跨域/未就绪静默跳过，保留浏览器默认） */
export function injectArtifactScrollbarStyle(doc: Document | null | undefined): void {
    try {
        if (!doc?.head || doc.getElementById('mobi-artifact-scrollbar')) return
        const style = doc.createElement('style')
        style.id = 'mobi-artifact-scrollbar'
        style.textContent = ARTIFACT_SCROLLBAR_STYLE
        doc.head.appendChild(style)
    } catch {
        // contentDocument 不可达（理论不可达：同源沙箱）——保留默认滚动条
    }
}

/** 双档 token 的最小投影类型（buildMobiThemeCss 只消费其中的色板/圆角键） */
type MobiThemeToken = Pick<
    typeof shadcnLightToken,
    | 'colorBgBase' | 'colorBgContainer' | 'colorBgElevated' | 'colorBgLayout'
    | 'colorText' | 'colorTextSecondary' | 'colorTextTertiary'
    | 'colorPrimary' | 'colorSuccess' | 'colorWarning' | 'colorError'
    | 'colorBorder' | 'colorBorderSecondary' | 'borderRadius'
>

/**
 * 构建 `--mobi-*` 主题 CSS（generative-ui 票 05，mode=app 注入；对齐 ChatGPT --viz-* 三招：
 * 主题变量 / base styles / 尺寸自适应——尺寸自适应归调用方 chrome，这里只管前两招）。
 *
 * 覆盖语义（app 自带样式永远赢）：
 * - 变量声明在 `:root`——是宿主→app 的输入通道（app 消费取色，不重定义）；
 * - color-scheme 与 base 样式（body 的 margin/背景/前景/字体）走 `:where()`（特异性 0），
 *   app 自身任何选择器（哪怕裸 `body`）都能覆盖；
 * - 字体变量给系统栈——宿主的 var(--font-body) 在 iframe 里解析不到。
 */
export function buildMobiThemeCss(mode: 'light' | 'dark'): string {
    const t: MobiThemeToken = mode === 'dark' ? shadcnDarkToken : shadcnLightToken
    return [
        `:where(:root) { color-scheme: ${mode}; }`,
        ':root {',
        `  --mobi-color-scheme: ${mode};`,
        `  --mobi-bg: ${t.colorBgContainer};`,
        `  --mobi-bg-base: ${t.colorBgBase};`,
        `  --mobi-bg-elevated: ${t.colorBgElevated};`,
        `  --mobi-bg-layout: ${t.colorBgLayout};`,
        `  --mobi-fg: ${t.colorText};`,
        `  --mobi-fg-secondary: ${t.colorTextSecondary};`,
        `  --mobi-fg-muted: ${t.colorTextTertiary};`,
        `  --mobi-primary: ${t.colorPrimary};`,
        `  --mobi-success: ${t.colorSuccess};`,
        `  --mobi-warning: ${t.colorWarning};`,
        `  --mobi-danger: ${t.colorError};`,
        `  --mobi-border: ${t.colorBorder};`,
        `  --mobi-border-muted: ${t.colorBorderSecondary};`,
        `  --mobi-radius: ${t.borderRadius}px;`,
        '  --mobi-font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;',
        '  --mobi-font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;',
        '}',
        ':where(body) { margin: 0; background: var(--mobi-bg); color: var(--mobi-fg); font-family: var(--mobi-font-body); }',
    ].join('\n')
}

const MOBI_THEME_STYLE_ID = 'mobi-app-theme'

/**
 * 注入/更新 `--mobi-*` 主题样式（幂等）：已存在则原地更新 textContent——宿主切换
 * 亮/暗时 app 即时跟随，无需重载 iframe。跨域/未就绪静默跳过。
 */
export function injectMobiThemeStyle(doc: Document | null | undefined, mode: 'light' | 'dark'): void {
    try {
        if (!doc?.head) return
        const existing = doc.getElementById(MOBI_THEME_STYLE_ID)
        if (existing) {
            existing.textContent = buildMobiThemeCss(mode)
            return
        }
        const style = doc.createElement('style')
        style.id = MOBI_THEME_STYLE_ID
        style.textContent = buildMobiThemeCss(mode)
        doc.head.appendChild(style)
    } catch {
        // contentDocument 不可达（理论不可达：同源沙箱）——不注入
    }
}

export interface SandboxHtmlFrameProps {
    sessionId: string
    /** 相对 session cwd 的 posix 路径（serve-file 的 relPath） */
    path: string
    /** 无障碍标题（调用方给语义名，如文件名 / 'html-preview'） */
    title: string
    /** chrome：尺寸/边框等由调用方声明 */
    style?: CSSProperties
    /** mode=app 专用（generative-ui 票 05）：注入 --mobi-* 主题变量并跟随宿主亮/暗 */
    injectTheme?: boolean
    /**
     * mode=app 专用（generative-ui 票 06）：app 内 `MobiApp.issueNewTurn(text)` 的宿主侧
     * 回调（校验收口在本组件，见文件头）。缺省 = 不开 bridge（普通产物零通道现状）。
     */
    onIssueNewTurn?: (text: string) => void
}

export function SandboxHtmlFrame({ sessionId, path, title, style, injectTheme = false, onIssueNewTurn }: SandboxHtmlFrameProps) {
    // 订阅同一 fileMeta query（react-query 按 queryKey 去重，多消费方零额外请求），
    // dataUpdatedAt 驱动 iframe 重建（机制见文件头）
    const { data: meta, dataUpdatedAt } = useFileMeta(sessionId, path)
    const themeMode = useUiStore((s) => resolveTheme(s.theme))
    const frameRef = useRef<HTMLIFrameElement | null>(null)
    // 回调经 ref 存（调用方闭包随渲染变化），监听器只挂一次不因回调变化重挂
    const onIssueNewTurnRef = useRef(onIssueNewTurn)
    onIssueNewTurnRef.current = onIssueNewTurn

    // 主题跟随：宿主题档变化 → 原地更新注入的 style（iframe 重建后 dataUpdatedAt 变化
    // 也经此补注——新文档 load 前 contentDocument 为 about:blank，注入幂等无副作用）
    useEffect(() => {
        if (injectTheme) injectMobiThemeStyle(frameRef.current?.contentDocument, themeMode)
    }, [injectTheme, themeMode, dataUpdatedAt])

    // bridge 监听（票 06）：来源 frame 校验（event.source === 本 frame 的 contentWindow）
    // 在这里做——白名单/schema/限流收口在 appBridge.ts。组件生命周期内挂一次；
    // iframe 重建不换 frameRef，但 key 变化会重挂整棵子树触发 onLoad 重注入脚本
    const bridgeEnabled = onIssueNewTurn !== undefined
    useEffect(() => {
        if (!bridgeEnabled) return
        const allowOnce = createAppBridgeRateLimiter()
        const handleMessage = (ev: MessageEvent) => {
            if (ev.source !== frameRef.current?.contentWindow) return
            const parsed = parseAppBridgeMessage(ev.data)
            if (!parsed || !allowOnce()) return
            onIssueNewTurnRef.current?.(parsed.text)
        }
        window.addEventListener('message', handleMessage)
        return () => window.removeEventListener('message', handleMessage)
    }, [bridgeEnabled])

    return (
        <iframe
            key={dataUpdatedAt}
            ref={frameRef}
            src={buildServeFileUrl(sessionId, path)}
            data-etag={meta?.etag ?? ''}
            sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
            referrerPolicy="no-referrer"
            title={title}
            onLoad={(e) => {
                injectArtifactScrollbarStyle(e.currentTarget.contentDocument)
                if (injectTheme) injectMobiThemeStyle(e.currentTarget.contentDocument, themeMode)
                if (bridgeEnabled) injectAppBridgeScript(e.currentTarget.contentDocument)
            }}
            style={style}
        />
    )
}
