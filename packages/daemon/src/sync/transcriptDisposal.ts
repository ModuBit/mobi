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
 * 删除会话时的 transcript 处置（session-retention 票 07）。
 *
 * 闸与语义（spec「删除」节）：native id 在场、路径可解析、CLI 已退出才删——
 * 三者缺一都保留文件并给出人读原因（transcriptRetainedReason），前端诚实告知
 * 「对话记录未删除及原因」。文件本就不存在（从未物化的 fork 行等）不算失败，
 * 按「已删除」口径返回（磁盘上确实没有该记录了）。
 *
 * 纯编排依赖 fs 注入，测试给假件即可断言删除调用与原因，不碰真实文件系统。
 */

import { rmSync, existsSync } from 'node:fs'
import { resolveTranscriptPath } from '@mobi/node-core/claudeSdk/transcriptPath'

export type TranscriptDisposition = {
    deleted: boolean
    /** deleted=false 时的人读原因；deleted=true 恒缺省 */
    retainedReason?: string
}

/** transcript 删除的 fs 依赖面（测试注入假件） */
export interface TranscriptFsDeps {
    exists: (path: string) => boolean
    remove: (path: string) => void
}

const nodeFsDeps: TranscriptFsDeps = {
    exists: (path) => existsSync(path),
    remove: (path) => rmSync(path, { recursive: true, force: false }),
}

/**
 * 处置 transcript。
 *
 * @param nativeSessionId 会话行绑定的 native id（null = 未绑定，保留并说明）
 * @param workingDirectory 会话工作目录（null = 无法定位项目目录，保留并说明）
 * @param cliExited CLI 是否已退出（进程还活着时删文件等于删它脚下的地板，必须保留）
 */
export function disposeTranscript(
    nativeSessionId: string | null | undefined,
    workingDirectory: string | null | undefined,
    cliExited: boolean,
    deps: TranscriptFsDeps = nodeFsDeps
): TranscriptDisposition {
    if (!cliExited) {
        return { deleted: false, retainedReason: 'Session process is still running' }
    }
    const resolved = resolveTranscriptPath(nativeSessionId, workingDirectory)
    if (!resolved.ok) {
        return { deleted: false, retainedReason: `Cannot resolve transcript path (${resolved.reason})` }
    }
    const transcriptFile = resolved.path
    // 同名目录（CC 为部分会话写的附属目录）与 jsonl 同生同灭；两者都不在场 = 无记录可删
    if (!deps.exists(transcriptFile)) {
        return { deleted: true }
    }
    try {
        deps.remove(transcriptFile)
    } catch (error) {
        return {
            deleted: false,
            retainedReason: `Failed to delete transcript: ${error instanceof Error ? error.message : String(error)}`,
        }
    }
    return { deleted: true }
}
