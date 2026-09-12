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
 * remote 模式的 mobi-apps MCP server（SDK createSdkMcpServer 壳）。
 *
 * 定位：**mobi 应用提供的工具族**——agent 触达 mobi 的全部能力，分两类：
 * - A 类 · UI 呈现：驱动 Web 界面（open_in_mobi 等，后续 focus_session / set_theme 进此）。
 *   依赖 Web 在线，瞬态呈现不落库。
 * - B 类 · 系统操作：会话操作（list_machines / list_sessions / create_session /
 *   send_message_to_session）。不依赖 Web，落库即终态。
 *
 * 两类同处一个 server（照 codex 的 codex_apps：一个 namespace 装全部应用工具）；
 * mobi-core 则是与 mobi 应用无关的内置基础能力（change_title / web 工具）。
 *
 * 仅挂 remote 壳：本 server 的工具都依赖 Hub 链路，local HTTP 壳不挂载。
 * 不设 alwaysLoad：默认 tool search defer，工具定义不进上下文。
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { ApiSessionClient } from '@/api/apiSession'
import { MOBI_APPS_SERVER_NAME } from '@mobi/shared'
import { createOpenInMobiToolForSession } from './openInMobiTool'
import { createListMachinesToolForSession } from './listMachinesTool'
import { createListSessionsToolForSession } from './listSessionsTool'
import { createCreateSessionToolForSession } from './createSessionTool'

export function createMobiAppsServer(client: ApiSessionClient) {
    // 本 server 的工具都仅挂 remote 壳：local HTTP 壳（startMobiMcpServer / stdio bridge）不挂载
    const openInMobiTool = createOpenInMobiToolForSession(client)
    const listMachinesTool = createListMachinesToolForSession(client)
    const listSessionsTool = createListSessionsToolForSession(client)
    const createSessionTool = createCreateSessionToolForSession(client)

    return createSdkMcpServer({
        name: MOBI_APPS_SERVER_NAME,
        version: '1.0.0',
        // server 级说明，照 codex 的一句话风格（codex_apps：'Tools provided by the Codex app.'）。
        // 一句话就够——检索与使用指导的责任在每个工具自己的 description 上，
        // 这里只回答"这个 server 是谁提供的"
        instructions: 'Tools provided by the Mobi app.',
        tools: [
            tool(
                openInMobiTool.name,
                openInMobiTool.description,
                openInMobiTool.inputSchema.shape,
                async (args: unknown) => openInMobiTool.execute(args),
            ),
            tool(
                listMachinesTool.name,
                listMachinesTool.description,
                listMachinesTool.inputSchema.shape,
                async (args: unknown) => listMachinesTool.execute(args),
            ),
            tool(
                listSessionsTool.name,
                listSessionsTool.description,
                listSessionsTool.inputSchema.shape,
                async (args: unknown) => listSessionsTool.execute(args),
            ),
            tool(
                createSessionTool.name,
                createSessionTool.description,
                createSessionTool.inputSchema.shape,
                async (args: unknown) => createSessionTool.execute(args),
            ),
        ],
    })
}
