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

import { createSdkMcpServer, tool, type AnyZodRawShape, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { ApiSessionClient } from '@/api/apiSession'
import { MOBI_APPS_SERVER_NAME } from '@mobi/shared'
import type { MobiToolTextResult } from './toolResult'
import { OPEN_IN_MOBI_TOOL_NAME, createOpenInMobiTool } from './openInMobiTool'
import { LIST_MACHINES_TOOL_NAME, createListMachinesTool } from './listMachinesTool'
import { LIST_SESSIONS_TOOL_NAME, createListSessionsTool } from './listSessionsTool'
import { CREATE_SESSION_TOOL_NAME, createCreateSessionTool } from './createSessionTool'
import { SEND_MESSAGE_TOOL_NAME, createSendMessageTool } from './sendMessageTool'

/**
 * 工具体（工具工厂的返回值）→ SDK 的 tool 定义。
 *
 * 工厂产出的是 transport 无关的四件套（name / description / inputSchema / execute），
 * 这里只做形状适配——SDK 要 `inputSchema.shape`，且 handler 收 `unknown` 再交给 execute
 * （execute 自己会 safeParse，不在这一层替工具做校验）。
 */
function toSdkTool<Shape extends AnyZodRawShape>(definition: {
    name: string
    description: string
    inputSchema: { shape: Shape }
    execute: (args: unknown) => Promise<MobiToolTextResult>
}): SdkMcpToolDefinition<Shape> {
    return tool(definition.name, definition.description, definition.inputSchema.shape, async (args: unknown) =>
        definition.execute(args)
    )
}

/**
 * mobi-apps 工具族：**一行 = 一个工具的名字 + 怎么用会话客户端把它造出来**。
 *
 * 名字与装配写在同一行，是为了让 {@link MOBI_APPS_TOOL_NAMES} 从这张表派生出去——
 * 加一个工具只加一行。此前「工具挂了」与「工具被预授权」是两处手抄的清单，漏掉后者的
 * 症状是编译过、行为退化成逐次弹审批（B 类工具那样等于编排不可用），编译器一处都不拦。
 *
 * 这一行也是**这一族唯一的装配点**：工具各自只认一个窄 deps（`SendMessageToolDeps` 等），
 * 与「这些 deps 由谁填」解耦；而「由谁填」此前散在五个 `createXxxToolForSession(client)` 里，
 * 每个三行、只转发一个方法，是五个同尺寸的浅模块（架构评审候选 #4 已收拢于此）。
 */
const MOBI_APPS_TOOLS = [
    {
        name: OPEN_IN_MOBI_TOOL_NAME,
        build: (client: ApiSessionClient) => createOpenInMobiTool({
            sendUiCommand: (action) => client.sendUiCommand(action),
        }),
    },
    {
        name: LIST_MACHINES_TOOL_NAME,
        build: (client: ApiSessionClient) => createListMachinesTool({
            listMachines: () => client.listOnlineMachinesForAgent(),
        }),
    },
    {
        name: LIST_SESSIONS_TOOL_NAME,
        build: (client: ApiSessionClient) => createListSessionsTool({
            listSessions: (query) => client.listSessionsForAgent(query),
        }),
    },
    {
        name: CREATE_SESSION_TOOL_NAME,
        build: (client: ApiSessionClient) => createCreateSessionTool({
            createSession: (input) => client.createSessionForAgent(input),
        }),
    },
    {
        name: SEND_MESSAGE_TOOL_NAME,
        build: (client: ApiSessionClient) => createSendMessageTool({
            sendMessage: (input) => client.sendMessageToSessionsForAgent(input),
        }),
    },
]

/** 本 server 的工具名（预授权清单的派生源，顺序即注册顺序） */
export const MOBI_APPS_TOOL_NAMES: readonly string[] = MOBI_APPS_TOOLS.map((row) => row.name)

/** 把本 server 的工具族造出来（transport 无关的工具体，SDK 形状适配在 createMobiAppsServer） */
export function buildMobiAppsTools(client: ApiSessionClient) {
    return MOBI_APPS_TOOLS.map((row) => row.build(client))
}

export function createMobiAppsServer(client: ApiSessionClient) {
    // 本 server 的工具都仅挂 remote 壳：local HTTP 壳（startMobiMcpServer / stdio bridge）不挂载
    return createSdkMcpServer({
        name: MOBI_APPS_SERVER_NAME,
        version: '1.0.0',
        // server 级说明，照 codex 的一句话风格（codex_apps：'Tools provided by the Codex app.'）。
        // 一句话就够——检索与使用指导的责任在每个工具自己的 description 上，
        // 这里只回答"这个 server 是谁提供的"
        instructions: 'Tools provided by the Mobi app.',
        tools: buildMobiAppsTools(client).map(toSdkTool),
    })
}
