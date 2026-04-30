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

import { ApiSessionClient } from "@/api/apiSession"
import { MessageQueue } from "@/utils/MessageQueue"
import { logger } from "@/ui/logger"
import { runLocalRemoteSession } from "@/agent/loopBase"
import { Session } from "./session"
import { claudeLocalLauncher } from "./claudeLocalLauncher"
import { claudeRemoteLauncher } from "./claudeRemoteLauncher"
import { ApiClient } from "@/lib"
import type { SessionModel } from "@/api/types"
import type { ClaudePermissionMode, EffortLevel } from "@mobi/shared/types"

export type PermissionMode = ClaudePermissionMode

/** SDK Query 动态控制引用，用于 setModel/setPermissionMode */
export type QueryControlRef = {
    current: {
        setPermissionMode: (m: PermissionMode) => Promise<void>
        setModel: (m?: string) => Promise<void>
        applyFlagSettings: (settings: Record<string, unknown>) => Promise<void>
    } | null
}

export interface EnhancedMode {
    permissionMode: PermissionMode;
    model?: string;
    effort?: EffortLevel;
    fallbackModel?: string;
    customSystemPrompt?: string;
    appendSystemPrompt?: string;
    allowedTools?: string[];
    disallowedTools?: string[];
}

interface LoopOptions {
    path: string
    model?: SessionModel
    permissionMode?: PermissionMode
    effort?: EffortLevel
    startingMode?: 'local' | 'remote'
    startedBy?: 'runner' | 'terminal'
    onModeChange: (mode: 'local' | 'remote') => void
    mcpServers: Record<string, any>
    apiSession: ApiSessionClient
    api: ApiClient,
    claudeEnvVars?: Record<string, string>
    claudeArgs?: string[]
    messageQueue: MessageQueue<EnhancedMode>
    allowedTools?: string[]
    onSessionReady?: (session: Session) => void
    hookSettingsPath: string
    processCleanupRef?: { current: (() => void) | null }
    queryControlRef?: QueryControlRef
    getSessionConfig?: () => EnhancedMode
    flushConfig?: () => void
}

export async function loop(opts: LoopOptions) {

    // Get log path for debug display
    const logPath = logger.logFilePath;
    const startedBy = opts.startedBy ?? 'terminal';
    const startingMode = opts.startingMode ?? 'local';
    const session = new Session({
        api: opts.api,
        client: opts.apiSession,
        path: opts.path,
        sessionId: null,
        claudeEnvVars: opts.claudeEnvVars,
        claudeArgs: opts.claudeArgs,
        mcpServers: opts.mcpServers,
        logPath: logPath,
        messageQueue: opts.messageQueue,
        allowedTools: opts.allowedTools,
        onModeChange: opts.onModeChange,
        mode: startingMode,
        startedBy,
        startingMode,
        hookSettingsPath: opts.hookSettingsPath,
        permissionMode: opts.permissionMode ?? 'default',
        model: opts.model,
        effort: opts.effort
    });

    const cleanup = opts.processCleanupRef;
    const queryControl = opts.queryControlRef;

    await runLocalRemoteSession({
        session,
        startingMode: opts.startingMode,
        logTag: 'loop',
        runLocal: (s) => claudeLocalLauncher(s, cleanup),
        runRemote: (s) => claudeRemoteLauncher(s, cleanup, queryControl, opts.getSessionConfig, opts.flushConfig),
        onSessionReady: opts.onSessionReady
    });
}
