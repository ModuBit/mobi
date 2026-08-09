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
 * 静态资源的分层 Cache-Control 策略（Hub 远端 PWA 冷启动慢的根因修复）。
 *
 * 背景：Hub 部署在远端（内网穿透/VPN/公网）时，PWA 冷启动存在 SW 接管竞态——
 * OS 刚拉起进程的瞬间，Service Worker 尚未 boot 完成，浏览器对 index.html / 主 bundle /
 * 字体的首批请求会绕过 SW 直连远端。SW precache 清单里虽有这些文件，但在 SW 激活接管前
 * 不会拦截请求。此时唯一能兜底的是浏览器 HTTP 缓存，而 Hub 用 hono/bun 的 serveStatic
 * 托管静态资源时默认不发任何 Cache-Control → 浏览器无法可靠缓存 → 每次冷启都重走慢隧道
 * 拉 2.5MB+ JS 与字体 → 几十秒到一分钟的启动延迟。
 *
 * 策略分层（按内容寻址与变更频率）：
 * - /assets/*：Vite 内容哈希命名，文件名即版本，可永久缓存 + immutable
 * - /fonts/*：文件名无哈希但极少变更；长缓存，更新靠 SW precache 的 revision 机制
 * - /brand/*：品牌图标，稳定，短期缓存
 * - 所有 HTML 响应 + /sw.js + /manifest.webmanifest：必须每次校验（no-cache），否则新版本推不下去
 *   （HTML 是入口，引用了哈希命名的 assets，必须始终拿到最新版才能解析到新 bundle；
 *    /sw.js 必须 no-cache，否则 SW 更新永远到不了客户端）
 *
 * 返回 null 表示不设缓存头（API/CLI 等动态响应保持原状，最小化 blast radius）。
 *
 * @param pathname 请求路径（不含 query），如 /assets/index-a1b2.js
 * @param contentType 响应 Content-Type（用于识别 HTML 入口，包括 SPA 深链回退的 index.html）
 */
export function staticCacheControl(
    pathname: string,
    contentType?: string,
): string | null {
    // API/CLI 动态响应一律不动（含 /api/.../serve-file 返回的 HTML 预览）：最小化 blast radius
    if (pathname.startsWith('/api/') || pathname.startsWith('/cli/')) {
        return null
    }
    // 构建产物：内容哈希命名，永久缓存
    if (pathname.startsWith('/assets/')) {
        return 'public, max-age=31536000, immutable'
    }
    // 字体：无哈希但极少变更，长缓存
    if (pathname.startsWith('/fonts/')) {
        return 'public, max-age=2592000'
    }
    // 品牌图标：稳定，短期缓存
    if (pathname.startsWith('/brand/')) {
        return 'public, max-age=86400'
    }
    // 所有 HTML 响应必须每次校验：覆盖 /、/index.html 以及 SPA 深链（/sessions/xxx）回退的 index.html
    if (contentType?.includes('text/html')) {
        return 'no-cache'
    }
    // SW 与 manifest 非 HTML，显式 no-cache 保证可更新
    if (pathname === '/sw.js' || pathname === '/manifest.webmanifest') {
        return 'no-cache'
    }
    // API/CLI 等动态响应：不动
    return null
}
