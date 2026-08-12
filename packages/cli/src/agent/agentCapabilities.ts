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

import { logger } from '@/ui/logger'

/**
 * Agent 会话定位信息（agent 自身的 session 标识 + 工作目录 + 类型）。
 * 调用 {@link syncAgentRename} 等能力时由各 agent 层构造。
 */
export interface AgentSessionLocator {
    /** agent 类型（如 'claude'），驱动 capability 注册表查找 */
    flavor: string
    /** agent 自身的 session 标识；会话未就绪时为 null */
    sessionId: string | null
    /** 会话工作目录 */
    path: string
}

/**
 * Agent 能力适配器：各 agent（Claude Code / 未来其他）实现此接口，
 * 按 flavor 注册到 agent capability registry。
 *
 * mobi 核心逻辑（MCP handler / RPC handler 等）通过 registry 调用，
 * 不直接依赖具体 agent 的 SDK —— 新增 agent 只需新增一个实现 + 注册，
 * 不改动核心。
 *
 * 能力均为可选：未实现的方法在调用时抛 unsupported，调用方 best-effort 吞。
 */
export interface AgentCapabilities {
    /** 回写 agent 侧会话标题（LWW，重复调用安全） */
    renameSession?(locator: AgentSessionLocator, title: string): Promise<void>
    // 未来扩展：extractMetadata?、validatePermission? ...
}

const registry = new Map<string, AgentCapabilities>()

/**
 * 注册某 agent 的能力。返回卸载函数（移除注册）。
 *
 * 通常在各 agent 的入口（如 Claude 的 `runClaude`）启动时注册一次，
 * 随会话生命周期常驻；卸载函数供测试隔离与动态卸载使用。
 */
export function registerAgentCapabilities(flavor: string, caps: AgentCapabilities): () => void {
    registry.set(flavor, caps)
    return () => {
        registry.delete(flavor)
    }
}

/**
 * 回写 agent 会话标题（Mobi → agent 单向同步）。
 *
 * 按 `locator.flavor` 查注册表调对应 agent 的实现。两个触发源都走此函数：
 * - Web UI 重命名 → Hub `rename-session` RPC → CLI handler → 此函数
 * - agent 调用标题变更工具（如 Claude 的 `change_title` MCP）→ handler → 此函数
 *
 * 会话未就绪（无 sessionId）/ agent 未注册 rename 能力 → throw，
 * 由调用方 best-effort 吞（不阻断 mobi 侧已完成的改名）。
 */
export async function syncAgentRename(
    locator: AgentSessionLocator | null,
    title: string
): Promise<void> {
    if (!locator?.sessionId) {
        throw new Error('Agent session not ready, cannot rename')
    }
    const caps = registry.get(locator.flavor)
    if (!caps?.renameSession) {
        throw new Error(`Agent '${locator.flavor}' does not support rename`)
    }
    await caps.renameSession(locator, title)
    logger.debug(`[agentCapabilities] 已回写 ${locator.flavor} 标题: ${title}`)
}
