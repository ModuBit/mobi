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
 * change_title 核心工具工厂（transport 无关）。
 *
 * 核心逻辑单点承载：发 summary 到 Hub（更新 mobi 侧标题 + Web 显示）→
 * best-effort 回写 agent 侧标题（失败不阻塞 mobi 侧已完成的改名）。
 * transport 适配器只做壳：local 模式经 HTTP MCP Server 的 registerTool 挂载，
 * remote 模式经 SDK createSdkMcpServer 进程内挂载（ADR 0001）。
 *
 * 依赖注入而非直接 import（syncAgentRename / ApiSessionClient），
 * 便于单测与未来 agent flavor 复用。
 */

import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { logger } from '@/ui/logger'
import type { ApiSessionClient } from '@/api/apiSession'
import type { AgentSessionLocator } from '@/agent/agentCapabilities'

export const CHANGE_TITLE_TOOL_NAME = 'change_title' as const

export interface ChangeTitleToolDeps {
    /** 发送 summary 消息到 Hub（更新 mobi 侧标题 + Web 显示） */
    sendSummary: ApiSessionClient['sendClaudeSessionMessage']
    /** 回写 agent 侧标题（实现为 syncAgentRename；会话未就绪时 throw） */
    syncRename: (locator: AgentSessionLocator | null, title: string) => Promise<void>
    /** 取当前 agent 会话定位（flavor + sessionId + path），用于回写 agent 侧标题 */
    getAgentLocator: () => AgentSessionLocator | null
}

/** MCP CallToolResult 的 text-only 子集（两种 transport 均接受此形态）；索引签名兼容 MCP SDK 的宽泛结果类型 */
export interface ChangeTitleToolResult {
    content: Array<{ type: 'text'; text: string }>
    isError: boolean
    [key: string]: unknown
}

export function createChangeTitleTool(deps: ChangeTitleToolDeps) {
    const changeTitleInputSchema = z.object({
        title: z.string().describe('The new title for the chat session'),
    })

    async function execute(rawArgs: unknown): Promise<ChangeTitleToolResult> {
        // transport 入参统一在此校验：HTTP registerTool（AnySchema 下回调入参 unknown）与
        // SDK 进程内回调共用同一解析路径
        const parsed = changeTitleInputSchema.safeParse(rawArgs);
        if (!parsed.success) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to change chat title: invalid arguments (${parsed.error.message})`,
                    },
                ],
                isError: true,
            };
        }
        const title = parsed.data.title;
        logger.debug('[mobiMCP] Changing title to:', title);
        try {
            // 1. 发 summary 到 Hub（更新 mobi 侧标题 + Web 显示）
            deps.sendSummary({
                type: 'summary',
                summary: title,
                leafUuid: randomUUID()
            });

            // 2. best-effort 回写 agent 侧标题（会话未就绪/SDK 失败不影响 mobi 侧已完成的改名）
            try {
                await deps.syncRename(deps.getAgentLocator(), title);
            } catch (renameError) {
                logger.debug('[mobiMCP] 回写 agent 标题失败 (best-effort，忽略):', renameError);
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: `Successfully changed chat title to: "${title}"`,
                    },
                ],
                isError: false,
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to change chat title: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }

    return {
        name: CHANGE_TITLE_TOOL_NAME,
        description: 'Change the title of the current chat session',
        title: 'Change Chat Title',
        inputSchema: changeTitleInputSchema,
        execute,
    }
}

export type ChangeTitleTool = ReturnType<typeof createChangeTitleTool>
