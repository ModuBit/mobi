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

import { renameSession } from '@anthropic-ai/claude-agent-sdk'
import type { AgentCapabilities, AgentSessionLocator } from '@/agent/agentCapabilities'
import type { Session } from './session'

/**
 * Claude Code 的 agent 能力实现。
 *
 * 在 `runClaude` 启动时通过 `registerAgentCapabilities('claude', claudeCapabilities)` 注册，
 * 之后 mobi 核心经 {@link syncAgentRename} 等函数按 flavor 调用，不直接依赖 SDK。
 */
export const claudeCapabilities: AgentCapabilities = {
    async renameSession(locator: AgentSessionLocator, title: string) {
        // sessionId 已由 syncAgentRename 守卫保证非空，此处用 ! 断言
        await renameSession(locator.sessionId!, title, { dir: locator.path })
    },
}

/** Claude flavor 常量，供注册与 locator 构造复用 */
export const CLAUDE_FLAVOR = 'claude' as const

/**
 * 从 Claude {@link Session} 构造 agent 无关的 locator。
 * 供 MCP / RPC handler 调用 {@link syncAgentRename} 时使用，flavor 固定为 claude。
 */
export function claudeLocator(session: Session | null): AgentSessionLocator | null {
    if (!session) return null
    return {
        flavor: CLAUDE_FLAVOR,
        sessionId: session.sessionId,
        path: session.path,
    }
}
