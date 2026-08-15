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
 * WITHOUT WARRANTIES OR CONDITIONS, ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { listSessions } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '@/ui/logger'

const CONTINUE_FLAGS = ['--continue', '-c']
const RESUME_FLAGS = ['--resume', '-r']

function hasFlag(args: string[], flags: string[]): boolean {
    return args.some(arg => flags.includes(arg))
}

/**
 * 把 `-c` / `--continue` 规范化为显式 `--resume <最近 sessionId>`。
 *
 * 背景（pending #6）：`-c` 无显式 session id，mobi 端识别不了，导致同一 Claude
 * 会话每次 `-c` 都新建一条 Hub session。而 mobi 主导选择 resume 目标后，下游
 * 全走现成的 `--resume` 路径（sessionFactory 的 tag 复用、claudeLocal 透传、
 * scanner 预加载、claudeRemote 的 resolveResumeSessionId），零额外改动。
 *
 * 语义对齐：`-c` = 「恢复本目录最近会话」。最近会话用 SDK 官方 `listSessions`
 * 枚举（按 lastModified 降序，含 git worktrees 归并），mobi 选定后**显式指定**
 * 给 claude——不是猜测 claude 的 `-c` 会选谁，而是让 claude 收到的就是我们的选择，
 * 不存在两边选择不一致。
 *
 * 降级策略（保留 -c 原样透传，行为退回现状，绝不变差）：
 * - 显式 `--resume` / `-r` 已存在 → resume 优先，不处理
 * - 目录无历史会话 / listSessions 失败 → 原样返回，由 claude 自行处理 `-c`
 *
 * @param claudeArgs 透传给 claude 的参数（会被替换）
 * @param cwd 工作目录（listSessions 的项目目录）
 */
export async function normalizeContinueArg(
    claudeArgs: string[] | undefined,
    cwd: string,
): Promise<string[]> {
    if (!claudeArgs || !hasFlag(claudeArgs, CONTINUE_FLAGS)) {
        return claudeArgs ?? []
    }
    // 显式 resume 优先：用户已指定目标，-c 无效（与 claude CLI 行为一致）
    if (hasFlag(claudeArgs, RESUME_FLAGS)) {
        return claudeArgs
    }

    try {
        const sessions = await listSessions({ dir: cwd, limit: 1 })
        const latest = sessions[0]
        if (!latest) {
            logger.debug(`[normalizeContinueArg] 目录 ${cwd} 无历史 claude 会话，保留 -c 原样透传`)
            return claudeArgs
        }

        logger.debug(`[normalizeContinueArg] -c → --resume ${latest.sessionId}（本目录最近会话）`)
        // 移除所有 continue flag，首个位置替换为显式 resume（--resume 需紧跟 id，
        // 后随参数如 prompt 文本原序保留）
        const firstIdx = claudeArgs.findIndex(arg => CONTINUE_FLAGS.includes(arg))
        return claudeArgs.flatMap((arg, i) => {
            if (!CONTINUE_FLAGS.includes(arg)) return [arg]
            return i === firstIdx ? ['--resume', latest.sessionId] : []
        })
    } catch (error) {
        logger.debug('[normalizeContinueArg] listSessions 失败，保留 -c 原样透传:', error)
        return claudeArgs
    }
}
