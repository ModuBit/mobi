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
 * remote 模式的 mobi-core MCP server（SDK createSdkMcpServer 壳）。
 *
 * 定位：mobi 内置基础能力（change_title / web_search / web_fetch）。
 * agent 驱动应用界面的工具族在 mobi-apps（mobiAppsServer）。
 *
 * web 工具经 claudeRemote 的 toolAliases 由内置名 WebSearch/WebFetch 重定向调用，
 * 本 server 只是执行载体；change_title 与 local HTTP 壳（startMobiMcpServer）共享核心。
 * 不设 alwaysLoad：默认 tool search defer，工具定义不进上下文。
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { ApiSessionClient } from '@/api/apiSession'
import type { AgentSessionLocator } from '@/agent/agentCapabilities'
import { createChangeTitleToolForSession } from './changeTitleTool'
import { webSearchTool, webFetchTool } from '@/webtools/server'

export function createMobiCoreServer(
    client: ApiSessionClient,
    /** 取当前 agent 会话定位（flavor + sessionId + path），用于 change_title 回写 agent 侧标题 */
    getAgentLocator: () => AgentSessionLocator | null,
) {
    const changeTitleTool = createChangeTitleToolForSession(client, getAgentLocator)

    return createSdkMcpServer({
        name: 'mobi-core',
        version: '1.0.0',
        tools: [
            tool(
                changeTitleTool.name,
                changeTitleTool.description,
                changeTitleTool.inputSchema.shape,
                async (args: unknown) => changeTitleTool.execute(args),
            ),
            // webSearchTool / webFetchTool 已是 SDK tool() 形态，直接挂载
            webSearchTool,
            webFetchTool,
        ],
    })
}
