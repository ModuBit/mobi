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
import { getErrorMessage, rpcError } from '../rpcResponses'
import { lookupMime } from './fileMime'

export type FileRangeReadResult =
    | { success: true; chunk: Uint8Array }
    | { success: false; error: string; code?: string }

/** 读取已通过通道策略校验的绝对路径元数据。 */
export async function readFileMetaAt(absPath: string): Promise<{ mime: string; size: number; etag: string }> {
    const st = await stat(absPath)
    return { mime: lookupMime(absPath), size: st.size, etag: `${st.size}-${Math.floor(st.mtimeMs)}` }
}

/**
 * 读取已通过通道策略校验的绝对路径字节范围。
 * 文件末段会截断到 EOF；路径安全和文件类型策略不属于此 module。
 */
export async function readFileRangeAt(
    absPath: string,
    offset?: number | null,
    length?: number | null,
): Promise<FileRangeReadResult> {
    try {
        const st = await stat(absPath)
        const normalizedOffset = Math.floor(offset ?? 0)
        const normalizedLength = Math.floor(length ?? RPC_BINARY_CHUNK_SIZE)
        if (!Number.isFinite(normalizedOffset)
            || !Number.isFinite(normalizedLength)
            || normalizedOffset < 0
            || normalizedLength < 0) {
            return rpcError('Invalid offset or length')
        }
        const clampedLength = Math.min(normalizedLength, st.size - normalizedOffset)
        if (normalizedOffset >= st.size || clampedLength <= 0) {
            return rpcError('Range out of bounds')
        }
        const chunks: Buffer[] = []
        for await (const chunk of createReadStream(absPath, {
            start: normalizedOffset,
            end: normalizedOffset + clampedLength - 1,
        })) {
            chunks.push(chunk)
        }
        return { success: true, chunk: new Uint8Array(Buffer.concat(chunks)) }
    } catch (error) {
        const code = (error as NodeJS.ErrnoException | null | undefined)?.code
        return rpcError(
            getErrorMessage(error, 'Failed to read file range'),
            code === 'ENOENT' ? { code: 'ENOENT' } : undefined,
        )
    }
}
