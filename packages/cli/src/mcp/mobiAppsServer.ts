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
 * 定位：agent 驱动 mobi 应用界面的工具族（A 类 UI 命令），
 * 后续 A 类扩展（focus_session、set_theme 等）挂载于此。
 * 内置基础能力（change_title / web 工具）在 mobi-core（mobiCoreServer）。
 *
 * 仅挂 remote 壳（D1）：open_in_mobi 的链路依赖 Hub/Web，local HTTP 壳不挂载。
 * 不设 alwaysLoad：默认 tool search defer，工具定义不进上下文。
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { ApiSessionClient } from '@/api/apiSession'
import { createOpenInMobiToolForSession } from './openInMobiTool'

export function createMobiAppsServer(client: ApiSessionClient) {
    // open_in_mobi 仅挂 remote 壳（D1）：local HTTP 壳（startMobiMcpServer / stdio bridge）不挂载
    const openInMobiTool = createOpenInMobiToolForSession(client)

    return createSdkMcpServer({
        name: 'mobi-apps',
        version: '1.0.0',
        tools: [
            tool(
                openInMobiTool.name,
                openInMobiTool.description,
                openInMobiTool.inputSchema.shape,
                async (args: unknown) => openInMobiTool.execute(args),
            ),
        ],
    })
}
