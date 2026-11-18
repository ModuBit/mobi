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
 * 会话 MCP / hook settings 装配（ADR 0001 transport 单一化）。
 *
 * tui-fork 票 06 起 local transport 退场：claude 子进程由 SDK 在 mobi 进程内直接
 * 驱动，hook 走 SDK 进程内回调、MCP server 走进程内 SDK server——零端口、零临时
 * 文件，不再有 HTTP server 壳与落盘 settings。
 *
 * server 按职责拆分（命名法：mobi-apps = mobi 应用提供的工具族，mobi-core = 内置
 * 基础能力）：
 * - mobi-apps：agent 触达 mobi 应用的工具族，含 A 类 UI 呈现（open_in_mobi）与
 *   B 类系统操作（list_sessions 等会话操作）。
 * - mobi-core：内置基础能力（change_title / web_search / web_fetch）。
 */

import type { Settings } from '@anthropic-ai/claude-agent-sdk'
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { MOBI_APPS_SERVER_NAME, MOBI_CORE_SERVER_NAME } from '@mobi/shared'
import type { AgentSessionLocator } from '../agent/agentCapabilities'
import type { ApiSessionClient } from '../api/apiSession'
import { MOBI_APPS_TOOL_NAMES, createMobiAppsServer } from './mobiAppsServer'
import { MOBI_CORE_TOOL_NAMES, createMobiCoreServer } from './mobiCoreServer'

export function buildSessionMcpServers(opts: {
    client: ApiSessionClient
    /** 取当前 agent 会话定位（flavor + sessionId + path），用于 change_title 回写 agent 侧标题 */
    getAgentLocator: () => AgentSessionLocator | null
}): Record<string, McpServerConfig> {
    return {
        'mobi-apps': createMobiAppsServer(opts.client),
        'mobi-core': createMobiCoreServer(opts.client, opts.getAgentLocator),
    }
}

/**
 * mobi 工具族的预授权清单（`mcp__<server>__<tool>`，SDK 的命名法）。
 *
 * **从各 server 的工具表派生**，不手抄：漏掉一条的症状是编译过得去、行为退化成
 * 「每次调用弹审批」——B 类工具那样等于编排不可用（理由见 docs/architecture/cli/mcp/README.md）。
 * 加一个工具只改它所在 server 的那张表一行。
 */
export const MOBI_PREAUTHORIZED_TOOLS: readonly string[] = [
    ...MOBI_APPS_TOOL_NAMES.map((name) => `mcp__${MOBI_APPS_SERVER_NAME}__${name}`),
    ...MOBI_CORE_TOOL_NAMES.map((name) => `mcp__${MOBI_CORE_SERVER_NAME}__${name}`),
]

/**
 * 会话的内联 hook settings：仅承载官方 settings 键 crossSessionInbound
 * （跨会话 peer 消息直达）。env 走 SDK Options.env、SessionStart hook 走 SDK
 * 进程内回调，均不进 settings。
 */
export const REMOTE_INLINE_HOOK_SETTINGS: Settings = Object.freeze({
    crossSessionInbound: 'accept',
}) as Settings
