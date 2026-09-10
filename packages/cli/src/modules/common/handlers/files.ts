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

import { MAX_UPLOAD_BYTES } from '@mobi/shared/upload'
import { fileEtag, type ReadFileMetaResponse, type RpcReadFileRangeResponse } from '@mobi/shared/fileMeta'
import { logger } from '@/ui/logger'
import { readFile, stat, writeFile, rename, unlink } from 'fs/promises'
import { createHash, randomUUID } from 'crypto'
import { join } from 'path'
import { homedir } from 'os'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { validateReadPath, validateWritePath } from '../pathSecurity'
import { getErrorMessage, rpcError } from '../rpcResponses'
import { fsError, readFileMetaAt, readFileRangeAt } from './fileRead'

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

export interface ReadFileMetaRequest {
    path: string
}

// 响应形状单源在 shared（ReadFileMetaResponse），此处 re-export 供 machineFiles 等消费方
export type { ReadFileMetaResponse }

export interface ReadFileRangeRequest {
    path: string
    offset: number
    length: number
}

// 响应形状单源在 shared（RpcReadFileRangeResponse），此处别名兼容既有引用
export type ReadFileRangeResponse = RpcReadFileRangeResponse

export function registerFileHandlers(
    rpcHandlerManager: RpcHandlerManager,
    workingDirectory: string,
    /** 用户 home（读边界 home 通道 + 黑名单基准；显式注入便于测试，缺省取系统 home） */
    homeDir: string = homedir(),
): void {
    // 读边界（cwd ∪ home−黑名单）与写边界（严格 cwd）分离——读放宽不放大写风险。
    // ~ 展开语义内聚在 shared 校验层（validateReadPath/validateWritePath），
    // valid 结果自带 resolvedPath，调用方直接用它读写，杜绝「校验对象 ≠ 实际读写对象」的漂移。
    // 边界拒绝统一带结构化码 ACCESS_DENIED，hub 据此映射 403（区别于 ENOENT→404 / 其他→500）
    const readable = (path: string) => validateReadPath(path, workingDirectory, homeDir)
    const writable = (path: string) => validateWritePath(path, workingDirectory, homeDir)

    // readFileMeta：stat → mime/size/etag（etag = size-mtimeMs，文件变化 mtime 必变）
    rpcHandlerManager.registerHandler<ReadFileMetaRequest, ReadFileMetaResponse>('readFileMeta', async (data) => {
        logger.debug('Read file meta:', data.path)

        const validation = readable(data.path)
        if (!validation.valid) {
            return rpcError(validation.error ?? 'Invalid file path', { code: 'ACCESS_DENIED' })
        }

        const result = await readFileMetaAt(validation.resolvedPath)
        if (!result.success) {
            // 整 result 落日志：保留 errno code 等结构化信息，非映射码（EACCES 等）排查不丢上下文
            logger.debug('Failed to read file meta:', result)
            return result
        }
        return { success: true, meta: result.meta, writable: writable(data.path).valid }
    })

    // readFileRange：无状态读 [offset, offset+length)，返回 Uint8Array（Socket.IO binary 附件）
    rpcHandlerManager.registerHandler<ReadFileRangeRequest, ReadFileRangeResponse>('readFileRange', async (data) => {
        logger.debug('Read file range:', data.path, data.offset, data.length)

        const validation = readable(data.path)
        if (!validation.valid) {
            return rpcError(validation.error ?? 'Invalid file path', { code: 'ACCESS_DENIED' })
        }

        const result = await readFileRangeAt(validation.resolvedPath, data.offset, data.length)
        if (!result.success) {
            logger.debug('Failed to read file range:', result)
        }
        return result
    })

    rpcHandlerManager.registerHandler<WriteFileRequest, WriteFileResponse>('writeFile', async (data) => {
        logger.debug('Write file request:', data.path)

        // 写边界（严格 cwd 子树）与可写性判定同源 validateWritePath；~ 前缀路径
        // 被显式拒绝（不做字面目录名写入），hash/stat 校验与实际写入都用 resolvedPath
        const validation = writable(data.path)
        if (!validation.valid) {
            return rpcError(validation.error ?? 'Invalid file path', { code: 'ACCESS_DENIED' })
        }

        try {
            if (data.expectedHash !== null && data.expectedHash !== undefined) {
                try {
                    const existingBuffer = await readFile(validation.resolvedPath)
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
                    await stat(validation.resolvedPath)
                    return rpcError('File already exists but was expected to be new')
                } catch (error) {
                    const nodeError = error as NodeJS.ErrnoException
                    if (nodeError.code !== 'ENOENT') {
                        throw error
                    }
                }
            }

            const buffer = Buffer.from(data.content, 'base64')
            await writeFile(validation.resolvedPath, buffer)

            const hash = createHash('sha256').update(buffer).digest('hex')

            return { success: true, hash }
        } catch (error) {
            logger.debug('Failed to write file:', error)
            return rpcError(getErrorMessage(error, 'Failed to write file'))
        }
    })

    // saveFile：覆盖已存在文件 + etag OCC + 原子写（tmp+rename）。
    // 对称 readFileMeta（etag = ${size}-${mtimeMs}）；baseEtag 由前端 readFileMeta 提供。
    // 仅覆盖已存在文件（新建走 upload 链路）；越权由 writable 校验（写边界严格 cwd）拦截。
    rpcHandlerManager.registerHandler<SaveFileRequest, SaveFileResponse>('saveFile', async (data) => {
        logger.debug('Save file:', data.path, 'baseEtag:', data.baseEtag)

        // 仅校验类型 + 大小上限；允许空内容（清空文件是合法操作）。
        // （旧逻辑拒绝 length===0，致用户无法把文件清空后保存）
        if (!(data.content instanceof Uint8Array)) {
            return rpcError('Invalid content')
        }
        if (data.content.length > MAX_UPLOAD_BYTES) {
            return rpcError('File too large (max 50MB)')
        }

        const validation = writable(data.path)
        if (!validation.valid) {
            return rpcError(validation.error ?? 'Invalid file path', { code: 'ACCESS_DENIED' })
        }

        const resolvedPath = validation.resolvedPath
        try {
            // OCC：stat 算当前 etag，比对 baseEtag（失败整形与读取通道同源 fsError）
            let st: Awaited<ReturnType<typeof stat>>
            try {
                st = await stat(resolvedPath)
            } catch (error) {
                return fsError(error, 'Failed to stat file')
            }
            const currentEtag = fileEtag(st.size, st.mtimeMs)
            // baseEtag='' → force 覆盖（跳过 OCC，用于冲突后用户选「强制覆盖」）；
            // 非空 → OCC 比对，不符则 conflict（正常 baseEtag 来自 readFileMeta，永非空）
            if (data.baseEtag !== '' && data.baseEtag !== currentEtag) {
                return { success: false, conflict: true, currentEtag }
            }

            // 原子写：tmp 与目标同目录（保证同设备 rename 原子），写完 rename 覆盖；失败清 tmp。
            // tmp 名含 randomUUID：仅 safeName+pid 是确定性的，同进程对同路径并发保存
            // （多 tab 编辑同一文件同时自动保存）会撞 tmp 名致覆盖/损坏，加随机后缀隔离。
            const safeName = data.path.replace(/[\\/]/g, '_')
            const tmpPath = join(resolvedPath, '..', `.mobi-tmp-${safeName}-${process.pid}-${randomUUID()}`)
            await writeFile(tmpPath, data.content)
            try {
                await rename(tmpPath, resolvedPath)
            } catch (err) {
                await unlink(tmpPath).catch(() => {})
                throw err
            }

            const newSt = await stat(resolvedPath)
            return { success: true, etag: fileEtag(newSt.size, newSt.mtimeMs) }
        } catch (error) {
            logger.debug('Failed to save file:', error)
            return rpcError(getErrorMessage(error, 'Failed to save file'))
        }
    })
}
