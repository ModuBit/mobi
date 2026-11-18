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

import { ApiSessionClient } from "../api/apiSession"
import type { LauncherDormancyFacts } from "./utils/dormancyGate";
import type { LiveCapabilityGetter } from "@mobi/node-core/handlers/commands"
import { MessageQueue } from "@mobi/node-core/utils/MessageQueue"
import { logger } from "@mobi/node-core/logger"
import { Session } from "./session"
import { claudeRemoteLauncher } from "./claudeRemoteLauncher"
import { ApiClient } from '@mobi/node-core/api/api'
import type { SessionModel } from "@mobi/node-core/api/types"
import type { EffortLevel } from "@mobi/shared/types"
import { PermissionMode, QueryControlRef, type EnhancedMode } from "./types"
import type { McpServerConfig, Settings } from "@anthropic-ai/claude-agent-sdk"
import type { ForkActivationPlan } from "./utils/forkActivation"

interface LoopOptions {
    path: string
    model?: SessionModel
    permissionMode?: PermissionMode
    effort?: EffortLevel
    /** 快速模式预设（Web spawn 透传；经 applyStartupFastMode（applyFlagSettings）注入） */
    fastMode?: boolean
    /** CC output style（Web spawn 透传；经 applyStartupOutputStyle（applyFlagSettings）注入） */
    outputStyle?: string
    /** 工作区冻结的额外工作目录（创建时来自工作区 folders，resume 时回放 metadata） */
    additionalDirectories?: string[]
    mcpServers: Record<string, McpServerConfig>
    apiSession: ApiSessionClient
    api: ApiClient,
    claudeEnvVars?: Record<string, string>
    claudeArgs?: string[]
    messageQueue: MessageQueue<EnhancedMode>
    allowedTools?: string[]
    onSessionReady?: (session: Session) => void
    hookSettings: Settings
    processCleanupRef?: { current: (() => void) | null }
    queryControlRef?: QueryControlRef
    getSessionConfig?: () => EnhancedMode
    flushConfig?: () => void
    /** fork 激活计划（runClaude 从 bootstrap metadata 解析后传入，fork-session spec §5.2） */
    forkActivation?: ForkActivationPlan | null
    /** 休眠 gate 事实回传（dormancy spec）：launcher 就绪后回填 provider，供 runClaude 组装 gate 快照 */
    onDormancyFacts?: (provider: () => LauncherDormancyFacts) => void
    /** 活 Query 能力源回传：refreshMetadata 直接问 Query，避免活跃会话再起探针进程 */
    onLiveCapabilitySource?: (getter: LiveCapabilityGetter) => void
}

/**
 * 会话宿主主循环（tui-fork 票 05）：local 模式退场后只剩 remote 一条驱动路径，
 * 不再有双模切换。会话由 Web/daemon 驱动，进程内 SDK Query 是唯一执行体。
 */
export async function loop(opts: LoopOptions) {
    const session = new Session({
        api: opts.api,
        client: opts.apiSession,
        path: opts.path,
        sessionId: null,
        claudeEnvVars: opts.claudeEnvVars,
        claudeArgs: opts.claudeArgs,
        mcpServers: opts.mcpServers,
        logPath: logger.logFilePath,
        messageQueue: opts.messageQueue,
        allowedTools: opts.allowedTools,
        hookSettings: opts.hookSettings,
        permissionMode: opts.permissionMode ?? 'default',
        model: opts.model,
        effort: opts.effort,
        fastMode: opts.fastMode,
        outputStyle: opts.outputStyle,
        additionalDirectories: opts.additionalDirectories,
        forkActivation: opts.forkActivation
    });

    opts.onSessionReady?.(session)

    await claudeRemoteLauncher(
        session,
        opts.processCleanupRef,
        opts.queryControlRef,
        opts.getSessionConfig,
        opts.flushConfig,
        opts.onDormancyFacts,
        opts.onLiveCapabilitySource,
    )
}
