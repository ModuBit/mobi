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

import { extname, isAbsolute, relative, resolve } from 'path'
import { stat } from 'fs/promises'
import { logger } from '@/ui/logger'
import { RPC_BINARY_CHUNK_SIZE } from '@mobi/shared'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { getErrorMessage, rpcError } from '../rpcResponses'
import { fileMetaAt, fileRangeAt } from './files'
import type { ReadFileMetaResponse, ReadFileRangeRequest, ReadFileRangeResponse } from './files'

/**
 * machine 通道文件读取策略（跨会话存活的静态资源读取，消息附件预览等）：
 *
 * - 同名覆盖 common handlers 在 machine 连接上的默认注册——registerHandler 是 Map.set，
 *   apiMachine 装配顺序里本模块后注册即生效。默认版 workingDirectory 固定为 runner 启动目录，
 *   无法按项目寻址；本版以显式 cwd 参数化（缺省回退 process.cwd()，对齐 uploads.ts 惯例）
 * - 安全边界 = cwd 严格约束：relative 判定天然拒 ../ 逃逸与同前缀兄弟目录（startsWith 会误放行）
 * - 类型白名单收窄攻击面：图片全家桶（附件预览）+ html/js/css（聊天内嵌页面渲染预留）。
 *   扩名单只动这一个集合，敏感类扩展名永不入列
 */

/** 面向消息附件 / 内嵌页面的可读扩展名（小写含点） */
const MACHINE_READ_ALLOWED_EXT = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico',
    '.html', '.js', '.css',
])

interface MachineReadFileMetaRequest {
    path: string
    /** 显式项目根目录；缺省回退 process.cwd() */
    cwd?: string
}

interface MachineReadFileRangeRequest extends ReadFileRangeRequest {
    /** 同上 */
    cwd?: string
}

/** 相对路径解析为 cwd 内绝对路径；逃逸（../ / 绝对路径 / cwd 自身）返回 null */
function resolveWithinCwd(cwd: string, relPath: string): string | null {
    if (!relPath) return null
    const abs = resolve(cwd, relPath)
    const rel = relative(cwd, abs)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
    return abs
}

function assertAllowedExt(absPath: string): string | null {
    const ext = extname(absPath).toLowerCase()
    if (!MACHINE_READ_ALLOWED_EXT.has(ext)) {
        return `File extension "${ext || '(none)'}" is not allowed over machine channel`
    }
    return null
}

export function registerMachineFileHandlers(rpcHandlerManager: RpcHandlerManager): void {
    rpcHandlerManager.registerHandler<MachineReadFileMetaRequest, ReadFileMetaResponse>('readFileMeta', async (data) => {
        const cwd = typeof data.cwd === 'string' && data.cwd.trim() !== '' ? data.cwd : process.cwd()
        const abs = resolveWithinCwd(cwd, data.path ?? '')
        if (!abs) {
            return rpcError('Invalid path: outside cwd boundary')
        }
        const denied = assertAllowedExt(abs)
        if (denied) {
            return rpcError(denied, { code: 'EXT_FORBIDDEN' })
        }

        try {
            logger.debug('[MACHINE] Read file meta:', abs)
            return { success: true, meta: await fileMetaAt(abs) }
        } catch (error) {
            logger.debug('[MACHINE] Failed to stat file:', error)
            // 透传 ENOENT 结构化码，hub 基于它精确映射 404
            const code = (error as NodeJS.ErrnoException | null | undefined)?.code
            return rpcError(
                getErrorMessage(error, 'Failed to read file meta'),
                code === 'ENOENT' ? { code: 'ENOENT' } : undefined,
            )
        }
    })

    rpcHandlerManager.registerHandler<MachineReadFileRangeRequest, ReadFileRangeResponse>('readFileRange', async (data) => {
        const cwd = typeof data.cwd === 'string' && data.cwd.trim() !== '' ? data.cwd : process.cwd()
        const abs = resolveWithinCwd(cwd, data.path ?? '')
        if (!abs) {
            return rpcError('Invalid path: outside cwd boundary')
        }
        const denied = assertAllowedExt(abs)
        if (denied) {
            return rpcError(denied, { code: 'EXT_FORBIDDEN' })
        }

        try {
            logger.debug('[MACHINE] Read file range:', abs, data.offset, data.length)
            const st = await stat(abs)
            const rawOffset = Math.floor(data.offset ?? 0)
            const rawLength = Math.floor(data.length ?? RPC_BINARY_CHUNK_SIZE)
            if (!Number.isFinite(rawOffset) || !Number.isFinite(rawLength) || rawOffset < 0 || rawLength < 0) {
                return rpcError('Invalid offset or length')
            }
            const length = Math.min(rawLength, st.size - rawOffset)
            if (rawOffset >= st.size || length <= 0) {
                return rpcError('Range out of bounds')
            }
            return { success: true, chunk: await fileRangeAt(abs, rawOffset, length) }
        } catch (error) {
            logger.debug('[MACHINE] Failed to read file range:', error)
            return rpcError(getErrorMessage(error, 'Failed to read file range'))
        }
    })
}
