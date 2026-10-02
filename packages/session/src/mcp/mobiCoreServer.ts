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
 * agent 触达 mobi 应用的工具族在 mobi-apps（mobiAppsServer）。
 *
 * web 工具经 claudeRemote 的 toolAliases 由内置名 WebSearch/WebFetch 重定向调用，
 * 本 server 只是执行载体；change_title 与 local HTTP 壳（startMobiMcpServer）共享核心。
 * 不设 alwaysLoad：默认 tool search defer，工具定义不进上下文。
 */

import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { ApiSessionClient } from '@/api/apiSession'
import { MOBI_CORE_SERVER_NAME } from '@mobi/shared'
import type { AgentSessionLocator } from '@/agent/agentCapabilities'
import { CHANGE_TITLE_TOOL_NAME, createChangeTitleToolForSession } from './changeTitleTool'
import { webSearchTool, webFetchTool } from '@/webtools/server'
import { toSdkTool } from './sdkTool'

/**
 * mobi-core 工具族：**一行 = 一个名字 + 怎么造**（与 mobi-apps 同形，见那边的说明）。
 *
 * 名字清单从这张表派生（{@link MOBI_CORE_TOOL_NAMES}），所以「挂了工具却没加进预授权」
 * 不会再发生。两个 web 工具是成品、不吃入参，但仍照统一签名收下（不用的参数加 `_` 前缀），
 * 好让这张表能被同一行代码遍历——**别改成显式行类型**：SDK 的 `SdkMcpToolDefinition<Schema>`
 * 里 `handler` 的参数 `InferShape<Schema>` 对 Schema 逆变，具体形状的工具赋不进
 * `SdkMcpToolDefinition<AnyZodRawShape>`（2026-09-13 试过，tsc 报 handler 参数不兼容），
 * 唯一能收宽的 `any` 又被 lint 的零 warning 预算挡着。
 */
const MOBI_CORE_TOOLS = [
    {
        name: CHANGE_TITLE_TOOL_NAME,
        build: (client: ApiSessionClient, getAgentLocator: () => AgentSessionLocator | null) =>
            toSdkTool(createChangeTitleToolForSession(client, getAgentLocator)),
    },
    {
        name: webSearchTool.name,
        build: (_client: ApiSessionClient, _getAgentLocator: () => AgentSessionLocator | null) => webSearchTool,
    },
    {
        name: webFetchTool.name,
        build: (_client: ApiSessionClient, _getAgentLocator: () => AgentSessionLocator | null) => webFetchTool,
    },
]

/** 本 server 的工具名（预授权清单的派生源，顺序即注册顺序） */
export const MOBI_CORE_TOOL_NAMES: readonly string[] = MOBI_CORE_TOOLS.map((row) => row.name)

export function createMobiCoreServer(
    client: ApiSessionClient,
    /** 取当前 agent 会话定位（flavor + sessionId + path），用于 change_title 回写 agent 侧标题 */
    getAgentLocator: () => AgentSessionLocator | null,
) {
    return createSdkMcpServer({
        name: MOBI_CORE_SERVER_NAME,
        version: '1.0.0',
        tools: MOBI_CORE_TOOLS.map((row) => row.build(client, getAgentLocator)),
    })
}
