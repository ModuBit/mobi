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
 * read-file 端点 URL 构造。
 *
 * 图片 / 音视频 / PDF 不走 react-query 的 content 通道（见 useFileRenderState 的 needsContent），
 * 而是把 URL 直接交给 `<img src>` / `<video src>` / pdfjs。这带来一个后果：
 * **URL 不变，浏览器就不会重新请求**——文件内容原地改了（路径与文件名不变）也看不到新内容，
 * 因为 React 传下去的 src 字符串一模一样，DOM 元素压根没被通知去重新加载。
 *
 * 所以内容版本必须体现在 URL 里：把 meta 的 etag（cli 侧 = `size-mtimeMs`，内容变则变）
 * 作为 `v` 参数并入。文件变化 → etag 变 → src 变 → 浏览器重新请求。
 * 这与文本类「etag 进 react-query queryKey」是同一思路，只是载体换成 URL。
 *
 * etag 稳定时 URL 也稳定，浏览器与 HTTP 协商缓存照常复用，不会白下载。
 */
export function buildReadFileUrl(
    sessionId: string,
    filePath: string,
    opts: {
        /** 文件内容版本（来自 meta.etag）；省略则不带 v（如尚未拿到 meta） */
        etag?: string
        /** 下载模式：追加 download=1，让 hub 下发 attachment content-disposition */
        download?: boolean
        /**
         * 重试计数：加载失败后手动重试用。
         * 与 etag 分开是有意的——401/cookie 过期时文件本身没变（etag 不变），
         * 只有独立的计数器才能造出新 URL 绕开缓存、触发重新认证。
         */
        retry?: number
    } = {},
): string {
    const params = new URLSearchParams({ path: filePath })
    if (opts.download) params.set('download', '1')
    if (opts.etag) params.set('v', opts.etag)
    if (opts.retry) params.set('_retry', String(opts.retry))
    return `/api/sessions/${sessionId}/read-file?${params.toString()}`
}
