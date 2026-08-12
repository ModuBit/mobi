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

import { renameSession } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '@/ui/logger'

/**
 * mobi 侧持有的 Claude 会话定位信息（SDK renameSession 需要 claudeSessionId + dir）
 */
export interface ClaudeSessionLocator {
    /** Claude Code 的 session UUID（jsonl 文件名），会话未就绪时为 null */
    sessionId: string | null
    /** 会话工作目录 = SDK renameSession 的 dir 参数 */
    path: string
}

/**
 * 回写 Claude Code 会话标题（customTitle），用于 Mobi → CC 单向同步。
 *
 * 两个触发源都走此函数：
 * - Web UI 重命名 → Hub RPC rename-session → CLI handler → 此函数
 * - change_title MCP（CC 调用）→ MCP handler → 此函数
 *
 * SDK renameSession 是 LWW 语义（most recent title wins），重复调用安全。
 * 会话未就绪（无 sessionId）时抛错 —— Hub 侧 best-effort 会吞掉此错误。
 */
export async function syncClaudeRename(
    locator: ClaudeSessionLocator | null,
    title: string
): Promise<void> {
    if (!locator?.sessionId) {
        throw new Error('Claude session not ready, cannot rename')
    }
    await renameSession(locator.sessionId, title, { dir: locator.path })
    logger.debug(`[renameClaudeSession] 已回写 CC 标题: ${title}`)
}
