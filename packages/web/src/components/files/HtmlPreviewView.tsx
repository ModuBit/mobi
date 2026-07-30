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

import { useMemo } from 'react'
import { Empty } from 'antd'
import { useTranslation } from 'react-i18next'
import TextContentView from './TextContentView'
import { encodePathSegments } from '@/core/utils/path'
import { useFileMeta } from '@/core/data/hooks/queries/useFileTree'

interface Props {
    sessionId: string
    filePath: string
    /** 'render'=预览(iframe), 'source'=源码(TextContentView) */
    view: 'render' | 'source'
    text: string
    wrap: boolean
}

export default function HtmlPreviewView({ sessionId, filePath, view, text, wrap }: Props) {
    if (view === 'source') {
        return <TextContentView text={text} filePath={filePath} highlight wrap={wrap} />
    }
    return <HtmlIframe sessionId={sessionId} filePath={filePath} />
}

/** 预览态：sandboxed iframe 指向 serve-file，相对路径基准交给浏览器原生解析 */
function HtmlIframe({ sessionId, filePath }: { sessionId: string; filePath: string }) {
    const { t } = useTranslation()

    // 订阅文件 meta：iframe 用 serve-file URL 直连，不走 react-query content，故顶部「刷新」
    // （invalidate sessionFileMeta）和切回窗口（refetchOnWindowFocus）对本预览都失效。
    // 这里把 iframe 的 key 绑到 meta 查询的 dataUpdatedAt——每次 refetch 都更新（不论 etag 是否
    // 变化）：iframe 重建 → 浏览器重新加载。用 dataUpdatedAt 而非 etag 是因为改引用的 CSS/JS 不会
    // 变 HTML 自身的 etag，但仍需重建 iframe 才能拉到新的引用资源。serve-file 已设
    // cache-control: no-cache，重建时 HTML 连同引用 CSS/JS 都回源验证拿最新。
    const { data: meta, dataUpdatedAt } = useFileMeta(sessionId, filePath)
    const etag = meta?.etag

    // filePath 来自文件树，已是相对 session cwd 的 posix 路径（parseDirectoryEntries 以 '.' 为根），
    // 正是 serve-file 端点的 relPath——直接拼接，无需再算相对路径。
    // 越界（如 ../）由 hub 侧 isWithinDir 兜底拦截。
    const src = useMemo(() => {
        if (!filePath) return null
        return `/api/sessions/${sessionId}/serve-file/${encodePathSegments(filePath)}`
    }, [sessionId, filePath])

    if (!src) {
        return <Empty description={t('files.previewUnavailable')} style={{ marginTop: 40 }} />
    }

    return (
        <div className="html-preview-view" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <iframe
                // key 绑 dataUpdatedAt（每次 meta refetch 都更新）：点「刷新」/切窗 refetch → 值变 →
                // React 重建 iframe → 重新加载最新内容（含引用的 CSS/JS）。不绑 etag：改引用资源不变 HTML etag。
                key={dataUpdatedAt}
                src={src}
                // 测试钩子：暴露当前 etag，便于断言 meta 已就绪
                data-etag={etag ?? ''}
                // 脚本可执行 + allow-same-origin：iframe 与 mobi 同源，引用的 CSS/JS 子资源才不会被
                // Chrome ORB（Opaque Response Blocking）拦截——sandboxed opaque origin 的跨源 no-cors
                // 子资源会被 ORB 丢弃，引用的外部样式/脚本不生效（实测加 same-origin 后 style.css 由
                // ERR_BLOCKED_BY_ORB 变 304 正常加载）。
                // 安全：allow-same-origin 让预览脚本获得 mobi origin 能力，但 serve-file 端点对 text/html
                // 注入了严格 CSP（PREVIEW_CSP，见 sessions.ts）——connect-src 'none' 禁掉所有 fetch/XHR，
                // 脚本无法以用户身份（httpOnly cookie）调 mobi API；img/media 禁外链防 GET 外带。残留外带面
                // （拼数据进 script/style 的 https 资源 URL）仅能拿到 localStorage 里 recent-paths/偏好等
                // 低价值 PII（凭证走 httpOnly cookie，不入 localStorage）。信任边界从「任意调 mobi API」
                // 收敛到「低价值 PII 可能被外带」，可接受（类 Live Server / CodePen）。
                sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
                referrerPolicy="no-referrer"
                style={{ flex: 1, border: 'none', minHeight: 0 }}
                title="html-preview"
            />
        </div>
    )
}
