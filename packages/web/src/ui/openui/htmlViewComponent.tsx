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
 * HtmlView 组件实现（票 03 移植）：沙箱 iframe 里的整页 HTML（canvas / 小游戏）。
 *
 * 来源：https://github.com/thesysdev/open-intelligent-ui `src/lib/components/html-view.tsx`
 * 与 `scheme.ts`（MIT，许可声明见 shared `openuiComponents/index.ts`）。
 *
 * 安全基线（与上游的差异，对齐 mobi ADR 0007 / PREVIEW_CSP）：
 * - iframe 只给 `allow-scripts`（不带 allow-same-origin → opaque origin，触不到宿主
 *   cookie/storage/API），无表单、无弹层、无导航；
 * - `connect-src 'none'`——**这是 mobi 的安全底线**（上游允许连 CDN，mobi 不允许任何
 *   XHR/WebSocket/beacon 出站）；
 * - `img-src` 只允许 data:/blob:（上游放开 https:，会变成任意跟踪像素通道）；
 * - script/style 仍可引 https CDN（canvas 库需要），与 PREVIEW_CSP 同口径。
 *
 * 主题：内容不继承 mobi 主题（与 ADR 0007 一致），只把 `color-scheme` 同步成当前
 * 档位，让页面内 light-dark()/默认控件跟随明暗。
 */

import { defineComponent, useIsStreaming, type ComponentRenderProps } from '@openuidev/react-lang'
import { htmlViewComponentSpec } from '@mobi/shared'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useColorScheme } from '@/ui/base/theme/useColorScheme'

const CSP = [
    "default-src 'none'",
    "script-src 'unsafe-inline' https:",
    "style-src 'unsafe-inline' https:",
    'font-src https: data:',
    'img-src data: blob:',
    'media-src data: blob:',
    "connect-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
].join('; ')

const MIN_HEIGHT = 80
const MAX_HEIGHT = 2400
const AUTO_START = 360

/**
 * 向宿主回报内容高度，让视图贴合内容。宿主可再次询问（"iui-html-view-measure"）：
 * 早于监听建立渲染的 frame 首次回报可能丢失。
 */
const REPORTER = `<script>(function(){var last=0;function send(){var h=Math.ceil(document.documentElement.getBoundingClientRect().height);if(Math.abs(h-last)>1){last=h;parent.postMessage({type:"iui-html-view-height",height:h},"*")}}addEventListener("message",function(e){if(e.source===parent&&e.data==="iui-html-view-measure"){last=0;send()}});addEventListener("load",send);new ResizeObserver(send).observe(document.documentElement);send()})()</script>`

function documentFor(html: string, scheme: 'light' | 'dark') {
    // CSP 放在最前，覆盖模型 markup 里的一切
    return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{color-scheme:${scheme}}html,body{margin:0}body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}</style>${REPORTER}${html}`
}

function HtmlViewView({ props }: ComponentRenderProps) {
    const p = props as { html: string; height?: number; title?: string }
    const streaming = useIsStreaming()
    const frame = useRef<HTMLIFrameElement>(null)
    const box = useRef<HTMLDivElement>(null)
    const scheme = useColorScheme(box)
    const fixed = typeof p.height === 'number' && p.height > 0 ? Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, p.height)) : null
    const [measured, setMeasured] = useState<number | null>(null)
    const html = typeof p.html === 'string' ? p.html : ''
    const srcDoc = useMemo(() => documentFor(html, scheme), [html, scheme])

    useEffect(() => {
        if (fixed) return
        const onMessage = (event: MessageEvent) => {
            if (event.source !== frame.current?.contentWindow) return
            const data = event.data as { type?: unknown; height?: unknown }
            if (data?.type === 'iui-html-view-height' && typeof data.height === 'number' && Number.isFinite(data.height)) {
                setMeasured(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, data.height)))
            }
        }
        window.addEventListener('message', onMessage)
        frame.current?.contentWindow?.postMessage('iui-html-view-measure', '*')
        return () => window.removeEventListener('message', onMessage)
    }, [fixed])

    // 流式未完成的页面每 chunk 都会重载；等完整后再跑
    const height = fixed ?? measured ?? AUTO_START
    return (
        <div ref={box} className="iui-html-view" style={{ height }}>
            {streaming ? (
                <div className="iui-html-view-wait">正在准备交互视图…</div>
            ) : (
                <iframe
                    ref={frame}
                    title={p.title || 'Interactive view'}
                    sandbox="allow-scripts"
                    srcDoc={srcDoc}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                />
            )}
        </div>
    )
}

export const htmlViewComponent = defineComponent({ ...htmlViewComponentSpec, component: HtmlViewView })
