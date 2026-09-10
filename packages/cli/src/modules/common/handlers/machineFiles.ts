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

import { extname, resolve } from 'path'
import { homedir } from 'os'
import { logger } from '@/ui/logger'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { getErrorMessage, rpcError } from '../rpcResponses'
import { validateReadPath } from '../pathSecurity'
import { readFileMetaAt, readFileRangeAt } from './fileRead'
import type { ReadFileMetaResponse, ReadFileRangeRequest, ReadFileRangeResponse } from './files'

/**
 * machine 通道文件读取策略（跨会话存活的静态资源读取，消息附件预览等）：
 *
 * - 同名覆盖 common handlers 在 machine 连接上的默认注册——registerHandler 是 Map.set，
 *   apiMachine 装配顺序里本模块后注册即生效。默认版 workingDirectory 固定为 runner 启动目录，
 *   无法按项目寻址；本版以显式 cwd 参数化（缺省回退 process.cwd()，对齐 uploads.ts 惯例）
 * - 安全边界 = 读边界（ADR 0004：cwd 子树 ∪ home−黑名单，与 session 通道同源 validateReadPath）；
 *   扩展名白名单是本通道独有的第二道收窄（附件/内嵌页场景不需要任意文本读取）
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

/**
 * machine 通道读取的统一入口策略：读边界（cwd ∪ home−黑名单）→ 扩展名白名单。
 * meta 与 range 两个 handler 共用，策略只此一处——改动不会两处漂移。
 */
function resolveAllowedMachinePath(
    cwd: string,
    relPath: string | undefined,
    homeDir: string,
): { abs: string } | { error: string; code?: string } {
    // 空路径拒绝（边界类拒绝统一 ACCESS_DENIED，hub 据此映射 403；EXT_FORBIDDEN 除外）
    if (!relPath) return { error: 'Invalid path: outside readable boundary', code: 'ACCESS_DENIED' }
    const effectiveCwd = typeof cwd === 'string' && cwd.trim() !== '' ? cwd : process.cwd()
    // 解析与校验同源：validateReadPath 的 valid 结果自带 resolvedPath，无手抄二次解析
    const validation = validateReadPath(relPath, effectiveCwd, homeDir)
    if (!validation.valid) {
        return { error: validation.error ?? 'Invalid path: outside readable boundary', code: 'ACCESS_DENIED' }
    }
    // cwd 自身不是可读文件目标（对齐旧 resolveWithinCwd 的「cwd 自身拒绝」语义）
    if (validation.resolvedPath === resolve(effectiveCwd)) {
        return { error: 'Invalid path: outside readable boundary', code: 'ACCESS_DENIED' }
    }
    const denied = assertAllowedExt(validation.resolvedPath)
    if (denied) {
        return { error: denied, code: 'EXT_FORBIDDEN' }
    }
    return { abs: validation.resolvedPath }
}

function assertAllowedExt(absPath: string): string | null {
    const ext = extname(absPath).toLowerCase()
    if (!MACHINE_READ_ALLOWED_EXT.has(ext)) {
        return `File extension "${ext || '(none)'}" is not allowed over machine channel`
    }
    return null
}

/**
 * machine 通道文件读取 handler：meta 与 range 共用统一入口策略（读边界 → 扩展名白名单）。
 */
export function registerMachineFileHandlers(rpcHandlerManager: RpcHandlerManager, homeDir: string = homedir()): void {
    const resolveAllowed = (cwd: string, relPath: string | undefined) => resolveAllowedMachinePath(cwd, relPath, homeDir)
    rpcHandlerManager.registerHandler<MachineReadFileMetaRequest, ReadFileMetaResponse>('readFileMeta', async (data) => {
        const resolved = resolveAllowed(data.cwd ?? '', data.path)
        if ('error' in resolved) {
            return rpcError(resolved.error, resolved.code ? { code: resolved.code } : undefined)
        }

        try {
            logger.debug('[MACHINE] Read file meta:', resolved.abs)
            return { success: true, meta: await readFileMetaAt(resolved.abs) }
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
        const resolved = resolveAllowed(data.cwd ?? '', data.path)
        if ('error' in resolved) {
            return rpcError(resolved.error, resolved.code ? { code: resolved.code } : undefined)
        }

        logger.debug('[MACHINE] Read file range:', resolved.abs, data.offset, data.length)
        const result = await readFileRangeAt(resolved.abs, data.offset, data.length)
        if (!result.success) {
            logger.debug('[MACHINE] Failed to read file range:', result.error)
        }
        return result
    })
}
