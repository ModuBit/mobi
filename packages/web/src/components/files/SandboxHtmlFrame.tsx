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
 * 聊天流产物 inline 是它的两个 chrome 形态，机制不许再各写一份——曾在两边逐行重复
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
 *
 * chrome 面（调用方决定）：尺寸、边框、圆角等经 style 透传；包装容器由调用方自理。
 */

import type { CSSProperties } from 'react'
import { useFileMeta } from '@/core/data/hooks/queries/useFileTree'
import { buildServeFileUrl } from '@/core/utils/fileUrl'

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

export interface SandboxHtmlFrameProps {
    sessionId: string
    /** 相对 session cwd 的 posix 路径（serve-file 的 relPath） */
    path: string
    /** 无障碍标题（调用方给语义名，如文件名 / 'html-preview'） */
    title: string
    /** chrome：尺寸/边框等由调用方声明 */
    style?: CSSProperties
}

export function SandboxHtmlFrame({ sessionId, path, title, style }: SandboxHtmlFrameProps) {
    // 订阅同一 fileMeta query（react-query 按 queryKey 去重，多消费方零额外请求），
    // dataUpdatedAt 驱动 iframe 重建（机制见文件头）
    const { data: meta, dataUpdatedAt } = useFileMeta(sessionId, path)
    return (
        <iframe
            key={dataUpdatedAt}
            src={buildServeFileUrl(sessionId, path)}
            data-etag={meta?.etag ?? ''}
            sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
            referrerPolicy="no-referrer"
            title={title}
            onLoad={(e) => injectArtifactScrollbarStyle(e.currentTarget.contentDocument)}
            style={style}
        />
    )
}
