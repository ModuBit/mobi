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
import { logger } from '@mobi/node-core/logger'
import { stat, writeFile, rename, unlink } from 'fs/promises'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { validateWritePath } from './pathSecurity'
import { getErrorMessage, rpcError } from './rpcResponses'
import { fsError, normalizeCwdParam } from './fileRead'

export interface SaveFileRequest {
    path: string
    content: Uint8Array
    baseEtag: string
    /** 显式工作区根目录（machine 通道注入；缺省回退注册时的 workingDirectory，对齐 uploads.ts 惯例） */
    cwd?: string
}

export type SaveFileResponse =
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


/**
 * saveFile 实现（ticket-17 本地化直调目标）：注册闭包与 LocalExecutor 共用，
 * 行为单源——socket 路径与本地直调不会分叉。
 */
export async function saveFileImpl(data: SaveFileRequest, workingDirectory: string, homeDir: string): Promise<SaveFileResponse> {
    logger.debug('Save file:', data.path, 'baseEtag:', data.baseEtag)

    // 仅校验类型 + 大小上限；允许空内容（清空文件是合法操作）。
    // （旧逻辑拒绝 length===0，致用户无法把文件清空后保存）
    if (!(data.content instanceof Uint8Array)) {
        return rpcError('Invalid content')
    }
    if (data.content.length > MAX_UPLOAD_BYTES) {
        return rpcError('File too large (max 50MB)')
    }

    // 写边界按 effectiveCwd 计算：machine 通道注入 cwd 时锚定注入值（与读边界同模式），
    // 缺省回退注册时的 workingDirectory（session 通道行为不变）
    const effectiveCwd = normalizeCwdParam(data.cwd, workingDirectory)
    const validation = validateWritePath(data.path, effectiveCwd, homeDir)
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
 
}
