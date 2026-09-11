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
 * remote 模式的 in-process mobi MCP server（SDK createSdkMcpServer 壳）。
 *
 * 与 local 模式的 HTTP server（startMobiMcpServer）共享 change_title 核心，
 * 工具按注册名 'mobi' 生成 mcp__mobi__change_title 前缀，与 HTTP 形态一致，
 * allowedTools 预授权零变更（ADR 0001）。
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { ApiSessionClient } from '@/api/apiSession'
import type { AgentSessionLocator } from '@/agent/agentCapabilities'
import { createChangeTitleToolForSession } from './changeTitleTool'
import { createOpenInMobiToolForSession } from './openInMobiTool'

export function createMobiSdkMcpServer(
    client: ApiSessionClient,
    /** 取当前 agent 会话定位（flavor + sessionId + path），用于回写 agent 侧标题 */
    getAgentLocator: () => AgentSessionLocator | null,
) {
    const changeTitleTool = createChangeTitleToolForSession(client, getAgentLocator)
    // open_in_mobi 仅挂 remote 壳（D1）：local HTTP 壳（startMobiMcpServer / stdio bridge）不挂载
    const openInMobiTool = createOpenInMobiToolForSession(client)

    return createSdkMcpServer({
        name: 'mobi',
        version: '1.0.0',
        // 不设 alwaysLoad：默认 tool search defer，工具定义不进上下文（与 mobi-web 一致）
        tools: [
            tool(
                changeTitleTool.name,
                changeTitleTool.description,
                changeTitleTool.inputSchema.shape,
                async (args: unknown) => changeTitleTool.execute(args),
            ),
            tool(
                openInMobiTool.name,
                openInMobiTool.description,
                openInMobiTool.inputSchema.shape,
                async (args: unknown) => openInMobiTool.execute(args),
            ),
        ],
    })
}
