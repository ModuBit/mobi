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
 * serve-file 的 viz 档处理器（票 02）：`GET /sessions/:id/serve-file/:path?viz=1`。
 *
 * 与 {@link serveFileContent} 的分工：那边是「原文流式透传 + 按 mime 恒注 CSP」；
 * 这边必须缓冲全文做 fragment 校验与文档组装（上限 1MB，一次 readFileRange 拿全，
 * 不走分片流）。CSP 同源 PREVIEW_CSP（viz 档不放宽任何面，运行时/CDN 均在
 * 现行白名单内）；缓存策略 no-cache（组装产物随运行时版本变化，etag 语义不成立）。
 */

import type { Context } from 'hono'
import { PREVIEW_CSP, fileMetaHttpStatus, type FileContentReader } from './serveFileContent'
import { assembleVizDocument, validateVizFragment, vizFragmentErrorDocument } from '../vizRuntime/assembleVizDocument'
import { basename } from 'node:path'

/** 组装文档的响应头（text/html 恒注 CSP + nosniff + no-cache） */
function vizResponse(body: string, status: 200 | 422 = 200): Response {
    return new Response(body, {
        status,
        headers: {
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy': PREVIEW_CSP,
            'x-content-type-options': 'nosniff',
            'cache-control': 'private, no-cache',
        },
    })
}

export async function serveVizDocument(c: Context, reader: FileContentReader, absPath: string): Promise<Response> {
    const meta = await reader.readFileMeta(absPath)
    if (!meta.success) {
        return c.json({ success: false, error: meta.error ?? 'Failed to read file meta' }, fileMetaHttpStatus(meta.code))
    }
    const { size } = meta.meta

    // 校验先行（超限在读全文之前拒绝，1MB 以外不进内存）
    const validation = validateVizFragment('', size)
    if (!validation.ok) {
        return vizResponse(vizFragmentErrorDocument(validation.error), 422)
    }

    const range = await reader.readFileRange(absPath, 0, size)
    if (!range.success || !range.chunk) {
        const error = range.success ? 'readFileRange returned no chunk' : 'Failed to read file'
        return c.json({ success: false, error }, 500)
    }
    const fragment = new TextDecoder('utf-8', { fatal: false }).decode(range.chunk)
    const fullValidation = validateVizFragment(fragment, range.chunk.byteLength)
    if (!fullValidation.ok) {
        return vizResponse(vizFragmentErrorDocument(fullValidation.error), 422)
    }

    return vizResponse(assembleVizDocument(fragment, basename(absPath, '.html')))
}
