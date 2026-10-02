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
 * 会话 MCP / hook settings 的按模式装配（transport 分流，ADR 0001）。
 *
 * server 按职责拆分（命名法：mobi-apps = mobi 应用提供的工具族，mobi-core = 内置基础能力）：
 * - mobi-apps：agent 触达 mobi 应用的工具族，含 A 类 UI 呈现（open_in_mobi）与
 *   B 类系统操作（list_machines 等会话操作）。仅 remote——链路依赖 Hub，
 *   local 不存在（D1）。
 * - mobi-core：内置基础能力（change_title / web_search / web_fetch）。
 *   remote 走 SDK 进程内 server；local 走 HTTP server 壳（仅 change_title，
 *   open_in_mobi / web 工具不挂——原 mobi-web 在 local 本就被 SDK server 序列化
 *   过滤，从未实际生效，此处不再挂载）。
 *
 * remote 模式（Web 控制，SDK Query 在 mobi 进程内）：hook settings 用内联对象——
 * 零端口、零临时文件。local 模式（终端控制，claude 独立子进程）：hook settings
 * 落盘文件——进程内回调对子进程不可达。
 */

import type { Settings } from '@anthropic-ai/claude-agent-sdk'
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { MOBI_APPS_SERVER_NAME, MOBI_CORE_SERVER_NAME } from '@mobi/shared'
import type { AgentSessionLocator } from '@/agent/agentCapabilities'
import type { ApiSessionClient } from '@/api/apiSession'
import { CROSS_SESSION_INBOUND_ACCEPT } from '@/modules/common/hooks/generateHookSettings'
import { MOBI_APPS_TOOL_NAMES, createMobiAppsServer } from './mobiAppsServer'
import { MOBI_CORE_TOOL_NAMES, createMobiCoreServer } from './mobiCoreServer'

export function buildSessionMcpServers(opts: {
    startingMode: 'local' | 'remote'
    /** local 模式 HTTP MCP server 的 url（remote 传 null，进程内 server 不经网络） */
    httpMcpUrl: string | null
    client: ApiSessionClient
    /** 取当前 agent 会话定位（flavor + sessionId + path），用于 change_title 回写 agent 侧标题 */
    getAgentLocator: () => AgentSessionLocator | null
}): Record<string, McpServerConfig> {
    if (opts.startingMode === 'remote') {
        return {
            'mobi-apps': createMobiAppsServer(opts.client),
            'mobi-core': createMobiCoreServer(opts.client, opts.getAgentLocator),
        }
    }

    // local 模式必须提供 HTTP server url；null 属装配时序 bug，显式失败而非静默空串
    if (!opts.httpMcpUrl) {
        throw new Error('local 模式 buildSessionMcpServers 缺少 httpMcpUrl（startMobiMcpServer 未先启动?）')
    }
    return {
        'mobi-core': { type: 'http' as const, url: opts.httpMcpUrl },
    }
}

/**
 * mobi 工具族的预授权清单（`mcp__<server>__<tool>`，SDK 的命名法）。
 *
 * **从各 server 的工具表派生**，不手抄：漏掉一条的症状是编译过得去、行为退化成
 * 「每次调用弹审批」——B 类工具那样等于编排不可用（理由见 docs/architecture/cli/mcp/README.md）。
 * 加一个工具只改它所在 server 的那张表一行。
 *
 * 两个 server 的名字都列上：local 模式不挂 mobi-apps，多出来的授权串不匹配任何工具、
 * 无害；反过来按模式裁剪会把「当前是哪个模式」混进这份纯派生里，得不偿失。
 */
export const MOBI_PREAUTHORIZED_TOOLS: readonly string[] = [
    ...MOBI_APPS_TOOL_NAMES.map((name) => `mcp__${MOBI_APPS_SERVER_NAME}__${name}`),
    ...MOBI_CORE_TOOL_NAMES.map((name) => `mcp__${MOBI_CORE_SERVER_NAME}__${name}`),
]

/**
 * remote 模式的内联 hook settings：仅承载官方 settings 键 crossSessionInbound
 * （跨会话 peer 消息直达，原 settings 文件语义平移）。env 走 SDK Options.env、
 * SessionStart hook 走 SDK 进程内回调，均不进 settings。
 */
export const REMOTE_INLINE_HOOK_SETTINGS: Settings = Object.freeze({
    crossSessionInbound: CROSS_SESSION_INBOUND_ACCEPT,
}) as Settings
