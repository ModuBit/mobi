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

import { resolve } from 'path'
import { logger } from '@mobi/node-core/logger'
import { rpcError } from './rpcResponses'
import { validateReadPath, validateWritePath } from './pathSecurity'
import { normalizeCwdParam, readFileMetaAt, readFileRangeAt } from './fileRead'
import type { ReadFileMetaResponse, ReadFileRangeRequest, ReadFileRangeResponse } from './files'

/**
 * machine 通道文件读取策略（跨会话存活的静态资源读取，消息附件预览等）：
 *
 * - 同名覆盖 common handlers 在 machine 连接上的默认注册——registerHandler 是 Map.set，
 *   apiMachine 装配顺序里本模块后注册即生效。默认版 workingDirectory 固定为 daemon 启动目录，
 *   无法按工作区寻址；本版以显式 cwd 参数化（缺省回退 process.cwd()，对齐 uploads.ts 惯例）
 * - 安全边界 = 读边界（ADR 0004：cwd 子树 ∪ home−黑名单 ∪ /tmp，与 session 通道同源
 *   validateReadPath）。曾有的扩展名白名单已废除（ADR 0006）：session 文件 RPC 的执行层
 *   无条件落在本通道，两链读边界必须完全同一函数同一参数形态，否则冷会话与活跃会话
 *   的文件读行为分叉；闸门 = 目录黑名单 + 敏感文件名单（凭证/历史/密钥，validateReadPath 单源）
 */

interface HostReadFileMetaRequest {
    path: string
    /** 显式工作区根目录；缺省回退 process.cwd() */
    cwd?: string
}

interface HostReadFileRangeRequest extends ReadFileRangeRequest {
    /** 同上 */
    cwd?: string
}

/**
 * machine 通道读取的统一入口策略：读边界（cwd ∪ home−黑名单 ∪ /tmp）。
 * meta 与 range 两个 handler 共用，策略只此一处——改动不会两处漂移。
 */
function resolveAllowedHostPath(
    cwd: string,
    relPath: string | undefined,
    homeDir: string,
): { abs: string } | { error: string; code?: string } {
    // 空路径拒绝（边界类拒绝统一 ACCESS_DENIED，daemon 据此映射 403）
    if (!relPath) return { error: 'Invalid path: outside readable boundary', code: 'ACCESS_DENIED' }
    const effectiveCwd = normalizeCwdParam(cwd, process.cwd())
    // 解析与校验同源：validateReadPath 的 valid 结果自带 resolvedPath，无手抄二次解析
    const validation = validateReadPath(relPath, effectiveCwd, homeDir)
    if (!validation.valid) {
        return { error: validation.error ?? 'Invalid path: outside readable boundary', code: 'ACCESS_DENIED' }
    }
    // cwd 自身不是可读文件目标（对齐旧 resolveWithinCwd 的「cwd 自身拒绝」语义）
    if (validation.resolvedPath === resolve(effectiveCwd)) {
        return { error: 'Invalid path: outside readable boundary', code: 'ACCESS_DENIED' }
    }
    return { abs: validation.resolvedPath }
}

/**
 * readFileMeta 实现（ticket-17 本地化直调目标）：注册闭包与 LocalExecutor 共用，
 * 行为单源——socket 路径与本地直调不会分叉。
 */
export function hostReadFileMetaImpl(data: HostReadFileMetaRequest, homeDir: string): Promise<ReadFileMetaResponse> {
    const resolved = resolveAllowedHostPath(data.cwd ?? '', data.path, homeDir)
    if ('error' in resolved) {
        return Promise.resolve(rpcError(resolved.error, resolved.code ? { code: resolved.code } : undefined))
    }

    logger.debug('[MACHINE] Read file meta:', resolved.abs)
    return readFileMetaAt(resolved.abs).then((result) => {
        if (!result.success) {
            logger.debug('[MACHINE] Failed to read file meta:', result)
            return result
        }
        // writable 与 machine saveFile 的写边界同源同参（validateWritePath 严格 cwd 子树）：
        // 判定与真实写校验漂移会让 web 显示可写但保存被拒（dormancy：冷编辑器经此通道读 meta）
        return { success: true, meta: result.meta, writable: validateWritePath(data.path, normalizeCwdParam(data.cwd, process.cwd()), homeDir).valid }
    })
}

/**
 * readFileRange 实现（同上，本地化直调目标）。
 */
export async function hostReadFileRangeImpl(data: HostReadFileRangeRequest, homeDir: string): Promise<ReadFileRangeResponse> {
    const resolved = resolveAllowedHostPath(data.cwd ?? '', data.path, homeDir)
    if ('error' in resolved) {
        return rpcError(resolved.error, resolved.code ? { code: resolved.code } : undefined)
    }

    logger.debug('[MACHINE] Read file range:', resolved.abs, data.offset, data.length)
    const result = await readFileRangeAt(resolved.abs, data.offset, data.length)
    if (!result.success) {
        logger.debug('[MACHINE] Failed to read file range:', result)
    }
    return result
}

