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
 * remote 模式（Web 控制，SDK Query 在 mobi 进程内）：mobi MCP 走 SDK 进程内
 * server、hook settings 用内联对象——零端口、零临时文件。
 * local 模式（终端控制，claude 独立子进程）：mobi MCP 走 HTTP server、
 * hook settings 落盘文件——进程内回调对子进程不可达。
 */

import type { Settings } from '@anthropic-ai/claude-agent-sdk'
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import type { AgentSessionLocator } from '@/agent/agentCapabilities'
import type { ApiSessionClient } from '@/api/apiSession'
import { CROSS_SESSION_INBOUND_ACCEPT } from '@/modules/common/hooks/generateHookSettings'
import { createMobiWebMcpServer } from '@/webtools/server'
import { createMobiSdkMcpServer } from './mobiSdkMcpServer'

export function buildSessionMcpServers(opts: {
    startingMode: 'local' | 'remote'
    /** local 模式 HTTP MCP server 的 url（remote 传 null，进程内 server 不经网络） */
    httpMcpUrl: string | null
    client: ApiSessionClient
    /** 取当前 agent 会话定位（flavor + sessionId + path），用于 change_title 回写 agent 侧标题 */
    getAgentLocator: () => AgentSessionLocator | null
}): Record<string, McpServerConfig> {
    const mobi: McpServerConfig = opts.startingMode === 'remote'
        ? createMobiSdkMcpServer(opts.client, opts.getAgentLocator)
        : (() => {
            // local 模式必须提供 HTTP server url；null 属装配时序 bug，显式失败而非静默空串
            if (!opts.httpMcpUrl) {
                throw new Error('local 模式 buildSessionMcpServers 缺少 httpMcpUrl（startMobiMcpServer 未先启动?）')
            }
            return { type: 'http' as const, url: opts.httpMcpUrl }
        })()

    return {
        mobi,
        'mobi-web': createMobiWebMcpServer(),
    }
}

/**
 * remote 模式的内联 hook settings：仅承载官方 settings 键 crossSessionInbound
 * （跨会话 peer 消息直达，原 settings 文件语义平移）。env 走 SDK Options.env、
 * SessionStart hook 走 SDK 进程内回调，均不进 settings。
 */
export const REMOTE_INLINE_HOOK_SETTINGS: Settings = Object.freeze({
    crossSessionInbound: CROSS_SESSION_INBOUND_ACCEPT,
}) as Settings
