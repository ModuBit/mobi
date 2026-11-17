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
 * 按需资源运行时缓存判定（纯函数，与 SW 运行时解耦，便于单测）。
 *
 * 背景：预缓存清单只覆盖应用壳（入口 + 首屏聚合 chunk + 入口 CSS + 字体），
 * shiki 语言包、pdfjs、excalidraw、openui 等按需 chunk 约 30MB 不再安装时全量下载。
 * 这些资源第一次被请求时由本判定接管，交给 CacheFirst 落盘，之后离线可用。
 *
 * 只接管同源 GET 的静态资源：
 * - `/assets/` 下的 JS/CSS chunk（文件名带内容 hash，CacheFirst 安全）
 * - `/excalidraw-assets/` 下的字体分片（unicode-range 按需拉取，文件内容不变）
 *
 * 壳资源虽也在 `/assets/` 下，但 workbox 的 precache 路由先注册、优先命中，
 * 不会重复进入运行时缓存。
 */

/** 判定所需的请求形状（SW 的 FetchEvent.request 满足此结构） */
export interface RuntimeCacheRequest {
    url: string
    method: string
    destination: string
}

/** 允许运行时缓存的资源类型：脚本、样式、字体 */
const CACHEABLE_DESTINATIONS = new Set(['script', 'style', 'font'])

/**
 * 是否交给「按需资源运行时缓存」处理。
 *
 * @param req 请求的 url / method / destination
 * @param origin 当前 SW 的 origin（同源校验；用参数注入便于单测）
 */
export function shouldRuntimeCache(req: RuntimeCacheRequest, origin: string): boolean {
    if (req.method !== 'GET') return false
    if (!CACHEABLE_DESTINATIONS.has(req.destination)) return false

    let url: URL
    try {
        url = new URL(req.url)
    } catch {
        return false
    }
    if (url.origin !== origin) return false

    return url.pathname.startsWith('/assets/') || url.pathname.startsWith('/excalidraw-assets/')
}
