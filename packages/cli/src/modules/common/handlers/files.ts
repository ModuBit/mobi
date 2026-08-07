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

import { RPC_BINARY_CHUNK_SIZE } from '@mobi/shared'
import { MAX_UPLOAD_BYTES } from '@mobi/shared/upload'
import { logger } from '@/ui/logger'
import { readFile, stat, writeFile, rename, unlink } from 'fs/promises'
import { createReadStream } from 'fs'
import { createHash } from 'crypto'
import { resolve, join } from 'path'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { validatePath } from '../pathSecurity'
import { getErrorMessage, rpcError } from '../rpcResponses'
import { lookupMime } from './fileMime'

interface WriteFileRequest {
    path: string
    content: string
    expectedHash?: string | null
}

interface WriteFileResponse {
    success: boolean
    hash?: string
    error?: string
}

interface SaveFileRequest {
    path: string
    content: Uint8Array
    baseEtag: string
}

type SaveFileResponse =
    | { success: true; etag: string }
    | { success: false; conflict: true; currentEtag: string }
    | { success: false; error: string; code?: string }

interface ReadFileMetaRequest {
    path: string
}

interface FileMeta {
    mime: string
    size: number
    etag: string
}

interface ReadFileMetaResponse {
    success: boolean
    meta?: FileMeta
    error?: string
    /** 结构化错误码（如 'ENOENT'），供 hub 精确分流 404/500，不依赖 error 文案正则 */
    code?: string
}

interface ReadFileRangeRequest {
    path: string
    offset: number
    length: number
}

interface ReadFileRangeResponse {
    success: boolean
    chunk?: Uint8Array
    error?: string
}

/** 单段最大 chunk（值在 @mobi/shared RPC_BINARY_CHUNK_SIZE 统一，与 hub 流式转发 / bun-engine 上限协同） */
const FILE_RANGE_CHUNK = RPC_BINARY_CHUNK_SIZE

export function registerFileHandlers(rpcHandlerManager: RpcHandlerManager, workingDirectory: string): void {
    // readFileMeta：stat → mime/size/etag（etag = size-mtimeMs，文件变化 mtime 必变）
    rpcHandlerManager.registerHandler<ReadFileMetaRequest, ReadFileMetaResponse>('readFileMeta', async (data) => {
        logger.debug('Read file meta:', data.path)

        const validation = validatePath(data.path, workingDirectory)
        if (!validation.valid) {
            return rpcError(validation.error ?? 'Invalid file path')
        }

        try {
            const resolvedPath = resolve(workingDirectory, data.path)
            const st = await stat(resolvedPath)
            return {
                success: true,
                meta: {
                    mime: lookupMime(data.path),
                    size: st.size,
                    etag: `${st.size}-${Math.floor(st.mtimeMs)}`,
                },
            }
        } catch (error) {
            logger.debug('Failed to stat file:', error)
            // 透传 errno code（ENOENT 等）让 hub 基于结构化码判 404，不再依赖文案
            const code = (error as NodeJS.ErrnoException | null | undefined)?.code
            return rpcError(
                getErrorMessage(error, 'Failed to read file meta'),
                code === 'ENOENT' ? { code: 'ENOENT' } : undefined,
            )
        }
    })

    // readFileRange：无状态读 [offset, offset+length)，返回 Uint8Array（Socket.IO binary 附件）
    rpcHandlerManager.registerHandler<ReadFileRangeRequest, ReadFileRangeResponse>('readFileRange', async (data) => {
        logger.debug('Read file range:', data.path, data.offset, data.length)

        const validation = validatePath(data.path, workingDirectory)
        if (!validation.valid) {
            return rpcError(validation.error ?? 'Invalid file path')
        }

        try {
            const resolvedPath = resolve(workingDirectory, data.path)
            const st = await stat(resolvedPath)
            // ?? 0 只挡 null/undefined，挡不住 NaN（Math.floor(NaN)=NaN 会绕过越界检查），需 Number.isFinite 显式校验
            const rawOffset = Math.floor(data.offset ?? 0)
            const rawLength = Math.floor(data.length ?? FILE_RANGE_CHUNK)
            if (!Number.isFinite(rawOffset) || !Number.isFinite(rawLength) || rawOffset < 0 || rawLength < 0) {
                return rpcError('Invalid offset or length')
            }
            const offset = rawOffset
            const length = Math.min(rawLength, st.size - offset)
            if (offset >= st.size || length <= 0) {
                return rpcError('Range out of bounds')
            }

            // createReadStream 的 end 是 inclusive，所以 end = offset + length - 1
            const chunks: Buffer[] = []
            for await (const c of createReadStream(resolvedPath, { start: offset, end: offset + length - 1 })) {
                chunks.push(c)
            }
            return { success: true, chunk: new Uint8Array(Buffer.concat(chunks)) }
        } catch (error) {
            logger.debug('Failed to read file range:', error)
            return rpcError(getErrorMessage(error, 'Failed to read file range'))
        }
    })

    rpcHandlerManager.registerHandler<WriteFileRequest, WriteFileResponse>('writeFile', async (data) => {
        logger.debug('Write file request:', data.path)

        const validation = validatePath(data.path, workingDirectory)
        if (!validation.valid) {
            return rpcError(validation.error ?? 'Invalid file path')
        }

        try {
            if (data.expectedHash !== null && data.expectedHash !== undefined) {
                try {
                    const existingBuffer = await readFile(data.path)
                    const existingHash = createHash('sha256').update(existingBuffer).digest('hex')

                    if (existingHash !== data.expectedHash) {
                        return rpcError(`File hash mismatch. Expected: ${data.expectedHash}, Actual: ${existingHash}`)
                    }
                } catch (error) {
                    const nodeError = error as NodeJS.ErrnoException
                    if (nodeError.code !== 'ENOENT') {
                        throw error
                    }
                    return rpcError('File does not exist but hash was provided')
                }
            } else {
                try {
                    await stat(data.path)
                    return rpcError('File already exists but was expected to be new')
                } catch (error) {
                    const nodeError = error as NodeJS.ErrnoException
                    if (nodeError.code !== 'ENOENT') {
                        throw error
                    }
                }
            }

            const buffer = Buffer.from(data.content, 'base64')
            await writeFile(data.path, buffer)

            const hash = createHash('sha256').update(buffer).digest('hex')

            return { success: true, hash }
        } catch (error) {
            logger.debug('Failed to write file:', error)
            return rpcError(getErrorMessage(error, 'Failed to write file'))
        }
    })

    // saveFile：覆盖已存在文件 + etag OCC + 原子写（tmp+rename）。
    // 对称 readFileMeta（etag = ${size}-${mtimeMs}）；baseEtag 由前端 readFileMeta 提供。
    // 仅覆盖已存在文件（新建走 upload 链路）；越权由 validatePath（含工作目录约束）拦截。
    rpcHandlerManager.registerHandler<SaveFileRequest, SaveFileResponse>('saveFile', async (data) => {
        logger.debug('Save file:', data.path, 'baseEtag:', data.baseEtag)

        if (!(data.content instanceof Uint8Array) || data.content.length === 0) {
            return rpcError('Content is required')
        }
        if (data.content.length > MAX_UPLOAD_BYTES) {
            return rpcError('File too large (max 50MB)')
        }

        const validation = validatePath(data.path, workingDirectory)
        if (!validation.valid) {
            return rpcError(validation.error ?? 'Invalid file path')
        }

        const resolvedPath = resolve(workingDirectory, data.path)
        try {
            // OCC：stat 算当前 etag，比对 baseEtag
            let st: Awaited<ReturnType<typeof stat>>
            try {
                st = await stat(resolvedPath)
            } catch (error) {
                const code = (error as NodeJS.ErrnoException).code
                return rpcError(
                    getErrorMessage(error, 'Failed to stat file'),
                    code === 'ENOENT' ? { code } : undefined,
                )
            }
            const currentEtag = `${st.size}-${Math.floor(st.mtimeMs)}`
            if (data.baseEtag !== currentEtag) {
                return { success: false, conflict: true, currentEtag }
            }

            // 原子写：tmp 与目标同目录（保证同设备 rename 原子），写完 rename 覆盖；失败清 tmp
            const safeName = data.path.replace(/[\\/]/g, '_')
            const tmpPath = join(resolvedPath, '..', `.mobi-tmp-${safeName}-${process.pid}`)
            await writeFile(tmpPath, data.content)
            try {
                await rename(tmpPath, resolvedPath)
            } catch (err) {
                await unlink(tmpPath).catch(() => {})
                throw err
            }

            const newSt = await stat(resolvedPath)
            return { success: true, etag: `${newSt.size}-${Math.floor(newSt.mtimeMs)}` }
        } catch (error) {
            logger.debug('Failed to save file:', error)
            return rpcError(getErrorMessage(error, 'Failed to save file'))
        }
    })
}
