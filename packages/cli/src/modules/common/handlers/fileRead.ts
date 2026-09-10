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

import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { RPC_BINARY_CHUNK_SIZE } from '@mobi/shared'
import { fileEtag, type RpcFileMeta, type RpcReadFileRangeResponse } from '@mobi/shared/fileMeta'
import { getErrorMessage, rpcError } from '../rpcResponses'
import { lookupMime } from './fileMime'

/** readFileMetaAt 的 Result 契约：失败整形（含 ENOENT 结构化码）在此 module 统一，handler 只透传 */
export type FileMetaReadResult =
    | { success: true; meta: RpcFileMeta }
    | { success: false; error: string; code?: string }

/**
 * fs 异常 → Result 失败分支的统一整形：errno code 全量透传为结构化码——
 * hub 按 ENOENT → 404 / ACCESS_DENIED → 403 / 其余 → 500 映射状态，
 * 未映射的 code 仍随响应体下发辅助诊断（权限、符号链接循环等），不依赖文案。
 */
export function fsError(error: unknown, fallback: string): { success: false; error: string; code?: string } {
    const code = (error as NodeJS.ErrnoException | null | undefined)?.code
    return rpcError(getErrorMessage(error, fallback), code ? { code } : undefined)
}

/** 读取已通过通道策略校验的绝对路径元数据。 */
export async function readFileMetaAt(absPath: string): Promise<FileMetaReadResult> {
    try {
        const st = await stat(absPath)
        return { success: true, meta: { mime: lookupMime(absPath), size: st.size, etag: fileEtag(st.size, st.mtimeMs) } }
    } catch (error) {
        return fsError(error, 'Failed to read file meta')
    }
}

/**
 * 读取已通过通道策略校验的绝对路径字节范围（末段截断到 EOF；offset/length 缺省为
 * 「从头读一个标准分片」）。路径安全和文件类型策略不属于此 module。
 */
export async function readFileRangeAt(
    absPath: string,
    offset?: number,
    length?: number,
): Promise<RpcReadFileRangeResponse> {
    // 纯算术归一与校验先行，非法请求不付文件系统调用
    const normalizedOffset = Math.floor(offset ?? 0)
    const normalizedLength = Math.floor(length ?? RPC_BINARY_CHUNK_SIZE)
    if (!Number.isFinite(normalizedOffset)
        || !Number.isFinite(normalizedLength)
        || normalizedOffset < 0
        || normalizedLength < 0) {
        return rpcError('Invalid offset or length')
    }
    try {
        const st = await stat(absPath)
        // 前置已保证 offset/length 非负：offset ≥ size 为起点越界，length 0 为空范围
        if (normalizedOffset >= st.size || normalizedLength === 0) {
            return rpcError('Range out of bounds')
        }
        const chunks: Buffer[] = []
        for await (const chunk of createReadStream(absPath, {
            start: normalizedOffset,
            // end 超出 EOF 时流自然截断，无需按文件大小预钳制
            end: normalizedOffset + normalizedLength - 1,
        })) {
            chunks.push(chunk)
        }
        return { success: true, chunk: Buffer.concat(chunks) }
    } catch (error) {
        return fsError(error, 'Failed to read file range')
    }
}
