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

import { claudeLocal } from "./claudeLocal";
import { GoalStatusHandler } from "./goalStatusHandler";
import { Session } from "./session";
import { createSessionScanner } from "./utils/sessionScanner";
import { buildAppendSystemPrompt } from "./utils/systemPrompt";
import { BaseLocalLauncher } from "@/modules/common/launcher/BaseLocalLauncher";
import { logger } from "@/ui/logger";
import type { EnhancedMode } from "./types";

/**
 * 从 claudeArgs 中解析 --resume / --continue 的 session ID
 * 当 session.sessionId 为 null 时（如 mobi --resume <id>），
 * 通过此函数从 claudeArgs 提取 Claude Code 的 session ID 供 scanner 预加载
 */
function extractSessionIdFromArgs(claudeArgs?: string[]): string | null {
    if (!claudeArgs) return null
    // --resume <sessionId> 或 --continue <sessionId> 或 -c <sessionId> 或 -r <sessionId>
    for (const flag of ['--resume', '-r', '--continue', '-c']) {
        const idx = claudeArgs.findIndex(arg => arg === flag)
        if (idx !== -1) {
            const next = claudeArgs[idx + 1]
            if (next && !next.startsWith('-')) {
                return next
            }
        }
    }
    return null
}

export async function claudeLocalLauncher(
    session: Session,
    processCleanupRef?: { current: (() => void) | null },
    /** 当前会话配置（customSystemPrompt / appendSystemPrompt），用于拼接 append system prompt。
     *  与 remote 模式同源（runClaude 的 getSessionConfig），保证两模式 append 行为一致。 */
    getSessionConfig: () => EnhancedMode = () => ({ permissionMode: 'default' }),
): Promise<'switch' | 'exit'> {

    // 优先使用 session.sessionId（remote 模式下由 SDK 设置），
    // 其次从 claudeArgs 中提取 --resume/--continue 的 session ID
    const scannerSessionId = session.sessionId ?? extractSessionIdFromArgs(session.claudeArgs);
    logger.debug(`[LocalLauncher] Creating scanner: sessionId=${scannerSessionId}, path=${session.path}`);

    // goal 状态处理器:双发 reportGoalStatus RPC + goal_progress 聊天消息
    const goalHandler = new GoalStatusHandler(session.client, (m) => session.client.sendClaudeSessionMessage(m));

    // Create scanner
    const scanner = await createSessionScanner({
        sessionId: scannerSessionId,
        workingDirectory: session.path,
        onMessage: (message) => {
            // Block SDK summary messages - we generate our own
            // summary 是session title，自己生成，参见 @cli/src/claude/utils/startMobiMcpServer.ts
            if (message.type !== 'summary') {
                session.client.sendClaudeSessionMessage(message)
            }
        },
        onAttachmentStatus: (status) => goalHandler.handle(status),
    });

    const handleSessionFound = (sessionId: string) => {
        scanner.onNewSession(sessionId);
    };
    session.addSessionFoundCallback(handleSessionFound);


    const launcher = new BaseLocalLauncher({
        label: 'local',
        failureLabel: 'Local Claude process failed',
        queue: session.queue,
        rpcHandlerManager: session.client.rpcHandlerManager,
        startedBy: session.startedBy,
        startingMode: session.startingMode,
        launch: async (abortSignal) => {
            // 启动时按当前配置拼接 append system prompt（与 remote 同逻辑），
            // local 模式 claude 为交互式 TUI，prompt 仅在启动时注入一次
            const config = getSessionConfig();
            const systemPromptAppend = buildAppendSystemPrompt(config);
            await claudeLocal({
                path: session.path,
                sessionId: session.sessionId,
                abort: abortSignal,
                claudeEnvVars: session.claudeEnvVars,
                claudeArgs: session.claudeArgs,
                mcpServers: session.mcpServers,
                allowedTools: session.allowedTools,
                hookSettingsPath: session.hookSettingsPath,
                systemPromptAppend,
            });
        },
        onLaunchSuccess: () => {
            session.consumeOneTimeFlags();
        },
        sendFailureMessage: (message) => {
            session.client.sendSessionEvent({ type: 'message', message });
        },
        recordLocalLaunchFailure: (message, exitReason) => {
            session.recordLocalLaunchFailure(message, exitReason);
        },
        abortLogMessage: 'doAbort',
        switchLogMessage: 'doSwitch'
    });

    if (processCleanupRef) {
        processCleanupRef.current = launcher.control.requestExit;
    }
    try {
        return await launcher.run();
    } finally {
        // Cleanup
        if (processCleanupRef) {
            processCleanupRef.current = null;
        }
        session.removeSessionFoundCallback(handleSessionFound);
        goalHandler.dispose();
        await scanner.cleanup();
    }
}
