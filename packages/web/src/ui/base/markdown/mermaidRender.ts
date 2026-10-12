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
 * mermaid 渲染共享层：懒加载 mermaid + svg 缓存 + 注入目标 DOM。
 *
 * 编辑器（decoration widget）与只读预览（MermaidDiagram React 组件）共用，
 * 共享同一份 mermaid 单例与 svg 缓存（同一份 code 不重复跑 dagre 布局）。
 *
 * 渲染成单个 `<img src="svg data URL">`：mermaid（dagre）输出的 SVG 动辄成百上千
 * DOM 节点，压成 1 个 img 节点后进 ProseMirror 文档无负担。
 */

// mermaid 库懒加载（~1MB，首次遇 mermaid 图才加载），模块级单例
let mermaidPromise: Promise<typeof import('mermaid')['default']> | null = null
export function loadMermaid(): Promise<typeof import('mermaid')['default']> {
    if (!mermaidPromise) {
        mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
            // 主题：default（深色 mermaid 对齐后续优化）
            mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict' })
            return mermaid
        })
    }
    return mermaidPromise
}

/** 将 mermaid 输出的 svg 字符串包成可渲染的 data URL（encodeURIComponent 紧凑，主流浏览器支持） */
export function svgToDataUrl(svg: string): string {
    return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

// code → 渲染结果缓存。decoration 每次事务都 recompute，缓存命中时直接注入 img，不重跑 dagre。
// 仅 code 真正变化（用户编辑该块）时才 miss → 异步重算。上限 50 简单 LRU（svg data URL 可达数十 KB）。
const SVG_CACHE_CAP = 50
const svgCache = new Map<string, string>() // code -> dataUrl
const errorCache = new Map<string, string>() // code -> 错误信息
const inflight = new Map<string, Promise<void>>() // code -> 进行中的渲染
function setSvgCache(code: string, dataUrl: string) {
    svgCache.set(code, dataUrl)
    if (svgCache.size > SVG_CACHE_CAP) svgCache.delete(svgCache.keys().next().value!)
}

/** 触发某 code 的渲染（若未缓存），缓存结果。不操作 DOM。 */
export function ensureRendered(code: string): Promise<void> {
    if (svgCache.has(code) || errorCache.has(code) || inflight.has(code)) {
        return inflight.get(code) ?? Promise.resolve()
    }
    const id = 'mermaid-' + code.length + '-' + Math.random().toString(36).slice(2, 8)
    // mermaid.render 会在 body 末尾建临时容器 d<id> 测量布局；成功时它自清，出错时遗留
    // （带 "Syntax error" 的错误 SVG 挂在页面底部）。渲染完主动清掉，无论成败。
    const cleanupTemp = () => {
        document.getElementById('d' + id)?.remove()
        document.getElementById(id)?.remove()
        inflight.delete(code)
    }
    const p = loadMermaid()
        .then((mermaid) => mermaid.render(id, code))
        .then(({ svg }) => { setSvgCache(code, svgToDataUrl(svg)) })
        .catch((e: unknown) => { errorCache.set(code, e instanceof Error ? e.message : String(e)) })
        .finally(cleanupTemp)
    inflight.set(code, p)
    return p
}

export interface MermaidResult {
    status: 'loading' | 'ready' | 'error'
    dataUrl?: string
    error?: string
}

/** 同步读缓存结果（不触发渲染）。供 React 组件按需用。 */
export function readMermaid(code: string): MermaidResult {
    if (svgCache.has(code)) return { status: 'ready', dataUrl: svgCache.get(code)! }
    if (errorCache.has(code)) return { status: 'error', error: errorCache.get(code)! }
    return { status: 'loading' }
}

/** 清空渲染缓存（测试用：隔离用例间的模块级缓存）。 */
export function resetMermaidCache(): void {
    svgCache.clear()
    errorCache.clear()
    inflight.clear()
}

/**
 * 把 code 渲染进目标容器（decoration widget 用）。
 * - 缓存命中：立即注入 img
 * - 未命中：先显示「渲染中…」，异步渲染完成后注入（widget 已销毁则写入脱离文档的节点，无害）
 */
export function renderMermaidInto(code: string, container: HTMLElement): void {
    const inject = () => {
        const r = readMermaid(code)
        if (r.status === 'ready') {
            container.innerHTML = `<img class="mermaid-diagram" src="${r.dataUrl}" alt="" draggable="false" style="max-width:100%" />`
        } else if (r.status === 'error') {
            container.innerHTML = `<pre style="margin:0;color:var(--ant-color-error,#ff4d4f);font-size:12px">${escapeHtml(r.error ?? '')}</pre>`
        }
    }
    inject()
    if (readMermaid(code).status === 'loading') {
        container.innerHTML = `<div style="padding:16px;color:var(--ant-color-text-tertiary,gray);font-size:12px">渲染中…</div>`
        void ensureRendered(code).then(inject)
    }
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
