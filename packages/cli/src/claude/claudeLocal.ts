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

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { logger } from "@/ui/logger";
import { restoreTerminalState } from "@/ui/terminalState";
import { claudeCheckSession } from "./utils/claudeCheckSession";
import { getProjectPath } from "./utils/path";
import { appendMcpConfigArg } from "./utils/mcpConfig";
import { systemPrompt } from "./utils/systemPrompt";
import { withBunRuntimeEnv } from "@/utils/bunRuntime";
import { spawnWithAbort } from "@/utils/spawnWithAbort";
import { stripNewlinesForWindowsShellArg } from "@/utils/shellEscape";
import { getClaudeExecutablePath } from "./sdk/claudeExecutable";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

export async function claudeLocal(opts: {
    abort: AbortSignal,
    sessionId: string | null,
    mcpServers?: Record<string, McpServerConfig>,
    path: string,
    claudeEnvVars?: Record<string, string>,
    claudeArgs?: string[]
    allowedTools?: string[]
    hookSettingsPath: string
}) {

    // Ensure project directory exists
    const projectDir = getProjectPath(opts.path);
    mkdirSync(projectDir, { recursive: true });

    // Check if user passed explicit session control flags.
    const hasContinueFlag = opts.claudeArgs?.some(arg => arg === '--continue' || arg === '-c');
    const hasResumeFlag = opts.claudeArgs?.some(arg => arg === '--resume' || arg === '-r');
    const hasUserSessionControl = Boolean(hasContinueFlag || hasResumeFlag);

    // Determine session strategy:
    // - If resuming an existing session: use --resume (unless user already supplied session control)
    // - If starting fresh: let Claude create a new session ID (reported via SessionStart hook)
    let startFrom = opts.sessionId;
    if (opts.sessionId && !claudeCheckSession(opts.sessionId, opts.path)) {
        startFrom = null;
    }

    if (opts.abort.aborted) {
        logger.debug('[ClaudeLocal] Abort already signaled before spawn; skipping launch');
        return startFrom ?? null;
    }

    // Build args for Claude CLI
    const args: string[] = [];

    if (startFrom && !hasUserSessionControl) {
        // Resume existing session
        args.push('--resume', startFrom);
    }

    args.push('--append-system-prompt', stripNewlinesForWindowsShellArg(systemPrompt));

    const cleanupMcpConfig = appendMcpConfigArg(args, opts.mcpServers, {
        baseDir: projectDir
    });

    if (opts.allowedTools && opts.allowedTools.length > 0) {
        args.push('--allowedTools', opts.allowedTools.join(','));
    }

    // Add custom Claude arguments
    if (opts.claudeArgs) {
        args.push(...opts.claudeArgs);
    }

    // Add hook settings for session tracking
    args.push('--settings', opts.hookSettingsPath);
    logger.debug(`[ClaudeLocal] Using hook settings: ${opts.hookSettingsPath}`);

    // 添加项目 .mobi 目录，使 Claude 可访问上传的附件
    const mobiDir = join(opts.path, '.mobi')
    args.push('--add-dir', mobiDir)
    logger.debug(`[ClaudeLocal] Adding mobi directory: ${mobiDir}`)

    // Prepare environment variables
    // Note: Local mode uses global Claude installation
    const env = {
        ...process.env,
        DISABLE_AUTOUPDATER: '1',
        ...opts.claudeEnvVars
    }

    logger.debug(`[ClaudeLocal] Spawning claude with args: ${JSON.stringify(args)}`);

    // Get Claude executable path (dev 模式回退 PATH 上的 claude)
    const claudeCommand = (await getClaudeExecutablePath()) ?? 'claude';
    logger.debug(`[ClaudeLocal] Using claude executable: ${claudeCommand}`);

    // Spawn the process
    try {
        process.stdin.pause();
        await spawnWithAbort({
            command: claudeCommand,
            args,
            cwd: opts.path,
            env: withBunRuntimeEnv(env, { allowBunBeBun: false }),
            signal: opts.abort,
            logLabel: 'ClaudeLocal',
            spawnName: 'claude',
            installHint: 'Claude CLI',
            includeCause: true,
            logExit: true,
            shell: false  // Use absolute path, no shell needed
        });
    } finally {
        cleanupMcpConfig?.();
        process.stdin.resume();
        restoreTerminalState();
    }

    return startFrom ?? null;
}
