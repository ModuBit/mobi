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
import type { SyncEngine } from '../../sync/syncEngine'

interface ServeOptions {
    /** 下载场景（read-file 的 download=1）：追加 attachment content-disposition */
    download?: boolean
    /** 额外响应头（serve-file 用于追加 x-content-type-options: nosniff） */
    extraHeaders?: Record<string, string>
    /** text/html 文档专属 CSP（serve-file 预览用），仅当 meta.mime 为 text/html 时注入 */
    htmlCsp?: string
}

/**
 * 从 read-file 抽出的共享文件服务逻辑：吃绝对路径，输出流式响应。
 * 流程：readFileMeta → 304 协商缓存 → Range(206) 解析 → 响应头 → stream 分片翻译。
 * read-file（单文件读取/下载）与 serve-file（HTML 预览静态资源）共用，避免复制粘贴。
 *
 * meta 读取失败时分流状态码：cli 侧 stat 对不存在文件抛 ENOENT，结构化 code='ENOENT' → 404
 * （对 iframe 友好，浏览器渲染原生缺页而非崩溃）；其他错误 → 500。
 */
export async function serveFileContent(
    c: Context,
    engine: SyncEngine,
    sessionId: string,
    absPath: string,
    opts: ServeOptions = {},
): Promise<Response> {
    const meta = await engine.readFileMeta(sessionId, absPath)
    if (!meta.success || !meta.meta) {
        const status = meta.code === 'ENOENT' ? 404 : 500
        return c.json({ success: false, error: meta.error ?? 'Failed to read file meta' }, status)
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
    // text/html 预览文档：注入严格 CSP，把 sandbox + allow-same-origin 的能力面收窄到
    // 「只能加载资源、不能联网发请求/调 mobi API」（connect-src 'none'）。仅作用于 html 文档本身，
    // CSS/JS 子资源（同目录或外部 CDN）照常服务。详见 serve-file 路由 PREVIEW_CSP 注释。
    if (opts.htmlCsp && mime.startsWith('text/html')) {
        c.header('content-security-policy', opts.htmlCsp)
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
            const r = await engine.readFileRange(sessionId, absPath, offset, len)
            if (!r.success || !r.chunk) {
                break
            }
            await s.write(r.chunk)
            offset += r.chunk.byteLength
        }
    })
}
