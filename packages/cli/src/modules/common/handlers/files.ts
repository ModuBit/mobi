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

import { logger } from '@/ui/logger'
import { readFile, stat, writeFile } from 'fs/promises'
import { createReadStream } from 'fs'
import { createHash } from 'crypto'
import { resolve } from 'path'
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

/** 单段最大 2MB（受 hub maxHttpBufferSize 4MB 约束，留余量） */
const FILE_RANGE_CHUNK = 2 * 1024 * 1024

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
            return rpcError(getErrorMessage(error, 'Failed to read file meta'))
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
}
