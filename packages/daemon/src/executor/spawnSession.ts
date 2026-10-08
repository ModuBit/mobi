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
 * 会话 spawn 编排（架构评审候选⑧票②）：daemon spawn 会话子进程的编排主体，
 * 从 startExecutor 闭包提升为依赖注入的模块级函数——测试直接喂假件驱动
 * （dedup / 目录分支 / worktree 清理时机 / webhook 超时），不起整套 executor。
 *
 * 编排流：唤醒去重 → 目录校验/创建 → worktree 创建 → spawn → pid 检查 →
 * 追踪登记 → webhook 等待（追踪表持有等待端）→ 结果上报。所有副作用经
 * SpawnSessionDeps 注入（accept dependencies, don't create them）。
 */

import { SpawnSessionOptions, SpawnSessionResult } from '@mobi/shared/hostProtocol';
import { logger } from '@mobi/node-core/logger';
import { hostChannelUrl } from '@mobi/node-core/hostChannel';
import { keepTail } from '@mobi/node-core/utils/keepTail';
import { buildClaudeSpawnArgs } from './spawnArgs';
import type { WorktreeInfo } from './worktree';
import type { SessionTrackingTable } from './sessionTrackingTable';

/** spawn 结果上报（executor 状态 lastSpawnError 的数据源；装配层可空） */
export type SpawnOutcome =
    | { type: 'success' }
    | { type: 'error'; details: { message: string; pid?: number; exitCode?: number | null; signal?: NodeJS.Signals | null } };

/** 编排消费的子进程监听面（cross-spawn ChildProcess 的结构子集，假件可塑） */
export type SpawnedCliProcess = {
    pid?: number | undefined;
    stderr?: { on(event: 'data', listener: (chunk: Buffer) => void): void } | null | undefined;
    once(event: 'error', listener: (error: Error) => void): void;
    removeListener(event: 'error', listener: (error: Error) => void): void;
    on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
    on(event: 'error', listener: (error: Error) => void): void;
};

export type SpawnSessionDeps = {
    trackingTable: SessionTrackingTable;
    /** 宿主通道端口（求值归 startExecutor：daemon 配置优先，直跑回退默认派生） */
    hostPort: number;
    reportOutcome?: (outcome: SpawnOutcome) => void;
    fs: {
        access(path: string): Promise<void>;
        mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
    };
    spawn: (args: string[], options: { cwd: string; detached: boolean; stdio: Array<'ignore' | 'pipe'>; env: Record<string, string | undefined> }) => SpawnedCliProcess;
    createWorktree: (input: { basePath: string; nameHint?: string }) => Promise<{ ok: true; info: WorktreeInfo } | { ok: false; error: string }>;
    removeWorktree: (input: { repoRoot: string; worktreePath: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
    isProcessAlive: (pid: number) => boolean;
    /** 会话级记忆裁决（agent-memory 票 02；三档隔离票 05 加 workspaceId 语境）：
     *  按 workspace 目录 + spawn 的 workspaceId 求值——active 返回注入子进程的 env
     *  （MOBI_MEMORY_ENGINE + HINDSIGHT_*），降级（off/非法/排除）返回空对象。
     *  装配层负责读 daemon 设置、解析隔离规则与同步管理配置文件；求值放装配、执行放 spawn */
    resolveMemoryEnv: (workspaceDirectory: string, workspaceId: string | undefined) => Promise<Record<string, string>>;
};

/** spawn 前 error 捕获的字符串化（error 事件负载到错误文案） */
const formatSpawnError = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
};

/**
 * mkdir 失败的 errno 文案树（纯函数，测试断言点）：EACCES/ENOTDIR/ENOSPC/EROFS
 * 各给行动建议，未知错误透传系统 message。
 */
export function describeMkdirError(directory: string, error: unknown): string {
    const errno = error as NodeJS.ErrnoException;
    let errorMessage = `Unable to create directory at '${directory}'. `;
    if (errno.code === 'EACCES') {
        errorMessage += `Permission denied. You don't have write access to create a folder at this location. Try using a different path or check your permissions.`;
    } else if (errno.code === 'ENOTDIR') {
        errorMessage += `A file already exists at this path or in the parent path. Cannot create a directory here. Please choose a different location.`;
    } else if (errno.code === 'ENOSPC') {
        errorMessage += `No space left on device. Your disk is full. Please free up some space and try again.`;
    } else if (errno.code === 'EROFS') {
        errorMessage += `The file system is read-only. Cannot create directories here. Please choose a writable location.`;
    } else {
        const errStr = errno.message || String(error);
        errorMessage += `System error: ${errStr}. Please verify the path is valid and you have the necessary permissions.`;
    }
    return errorMessage;
}

/** webhook 等待失败文案（纯函数，测试断言点）：reason 主文案 + exit 观测 + stderr tail 截断 */
export function buildWebhookFailureMessage(
    reason: 'timeout' | 'exit-before-webhook' | 'process-error-before-webhook',
    pid: number,
    observed: { exitCode: number | null; exitSignal: NodeJS.Signals | null },
    stderrTail: string,
): string {
    let message: string;
    if (reason === 'exit-before-webhook') {
        message = `Session process exited before webhook for PID ${pid}`;
    } else if (reason === 'process-error-before-webhook') {
        message = `Session process error before webhook for PID ${pid}`;
    } else {
        message = `Session webhook timeout for PID ${pid}`;
    }

    if (observed.exitCode !== null || observed.exitSignal) {
        if (observed.exitCode !== null) {
            message += ` (exit code ${observed.exitCode})`;
        } else {
            message += ` (signal ${observed.exitSignal})`;
        }
    }

    const trimmedTail = stderrTail.trim();
    if (trimmedTail) {
        const compactTail = trimmedTail.replace(/\s+/g, ' ');
        const tailForMessage = compactTail.length > 800 ? compactTail.slice(-800) : compactTail;
        message += `. stderr: ${tailForMessage}`;
    }

    return message;
}

const MAX_TAIL_CHARS = 4000;

/** Spawn a new session (sessionId reserved for future --resume functionality) */
export async function spawnSession(options: SpawnSessionOptions, deps: SpawnSessionDeps): Promise<SpawnSessionResult> {
    logger.debugLargeJson('[EXECUTOR] Spawning session', options);

    // 唤醒去重（.scratch/wake-dedup）：同机已有活 child 以相同 resume 目标拉起时
    // 不再 spawn 第二个进程。「表项存在 = 进程存活」由 exit 既有清理保证；查重
    // 决策与结果构造单源见 spawnDedup。server 侧对 already-running 零等待幂等消费（票 02）
    const dedupHit = deps.trackingTable.checkResumeDedup(options.resumeSessionId);
    if (dedupHit) {
        logger.debug('[EXECUTOR] Spawn deduped: live child already resuming this session');
        return dedupHit;
    }

    const { directory, approvedNewDirectoryCreation = true } = options;
    const sessionType = options.sessionType ?? 'simple';
    const worktreeName = options.worktreeName;
    let directoryCreated = false;
    let spawnDirectory = directory;
    let worktreeInfo: WorktreeInfo | null = null;
    let MobiProcess: SpawnedCliProcess | null = null;

    // 判断directory是否存在，如果不存在则尝试创建
    if (sessionType === 'simple') {
        try {
            await deps.fs.access(directory);
            logger.debug(`[EXECUTOR] Directory exists: ${directory}`);
        } catch (_error) {
            logger.debug(`[EXECUTOR] Directory doesn't exist, creating: ${directory}`);

            // Check if directory creation is approved
            if (!approvedNewDirectoryCreation) {
                logger.debug(`[EXECUTOR] Directory creation not approved for: ${directory}`);
                return {
                    type: 'requestToApproveDirectoryCreation',
                    directory
                };
            }

            try {
                await deps.fs.mkdir(directory, { recursive: true });
                logger.debug(`[EXECUTOR] Successfully created directory: ${directory}`);
                directoryCreated = true;
            } catch (mkdirError: unknown) {
                const errorMessage = describeMkdirError(directory, mkdirError);
                logger.debug(`[EXECUTOR] Directory creation failed: ${errorMessage}`);
                return {
                    type: 'error',
                    errorMessage
                };
            }
        }
    } else {
        try {
            await deps.fs.access(directory);
            logger.debug(`[EXECUTOR] Worktree base directory exists: ${directory}`);
        } catch (_error) {
            logger.debug(`[EXECUTOR] Worktree base directory missing: ${directory}`);
            return {
                type: 'error',
                errorMessage: `Worktree sessions require an existing Git repository. Directory not found: ${directory}`
            };
        }
    }

    // 尝试创建worktree
    if (sessionType === 'worktree') {
        const worktreeResult = await deps.createWorktree({
            basePath: directory,
            nameHint: worktreeName
        });
        if (!worktreeResult.ok) {
            logger.debug(`[EXECUTOR] Worktree creation failed: ${worktreeResult.error}`);
            return {
                type: 'error',
                errorMessage: worktreeResult.error
            };
        }
        worktreeInfo = worktreeResult.info;
        spawnDirectory = worktreeInfo.worktreePath;
        logger.debug(`[EXECUTOR] Created worktree ${worktreeInfo.worktreePath} (branch ${worktreeInfo.branch})`);
    }

    const cleanupWorktree = async () => {
        if (!worktreeInfo) {
            return;
        }
        const result = await deps.removeWorktree({
            repoRoot: worktreeInfo.basePath,
            worktreePath: worktreeInfo.worktreePath
        });
        if (!result.ok) {
            logger.debug(`[EXECUTOR] Failed to remove worktree ${worktreeInfo.worktreePath}: ${result.error}`);
        }
    };
    const maybeCleanupWorktree = async (reason: string) => {
        if (!worktreeInfo) {
            return;
        }
        const pid = MobiProcess?.pid;
        if (pid && deps.isProcessAlive(pid)) {
            logger.debug(`[EXECUTOR] Skipping worktree cleanup after ${reason}; child still running`, {
                pid,
                worktreePath: worktreeInfo.worktreePath
            });
            return;
        }
        await cleanupWorktree();
    };

    try {
        // Resolve authentication token if provided
        let extraEnv: Record<string, string> = {};
        if (options.token) {
            // Mobi 当前仅支持 Claude
            extraEnv = {
                CLAUDE_CODE_OAUTH_TOKEN: options.token
            };
        }

        if (worktreeInfo) {
            extraEnv = {
                ...extraEnv,
                MOBI_WORKTREE_BASE_PATH: worktreeInfo.basePath,
                MOBI_WORKTREE_BRANCH: worktreeInfo.branch,
                MOBI_WORKTREE_NAME: worktreeInfo.name,
                MOBI_WORKTREE_PATH: worktreeInfo.worktreePath,
                MOBI_WORKTREE_CREATED_AT: String(worktreeInfo.createdAt)
            };
        }

        // Construct arguments for the CLI（纯函数构造，便于单测）
        const args = buildClaudeSpawnArgs(options);

        let stderrTail = '';
        const appendTail = (current: string, chunk: Buffer | string): string => {
            const text = chunk.toString();
            return text ? keepTail(current + text, MAX_TAIL_CHARS) : current;
        };
        const logStderrTail = () => {
            const trimmed = stderrTail.trim();
            if (!trimmed) {
                return;
            }
            logger.debug('[EXECUTOR] Child stderr tail', trimmed);
        };

        // 记忆 env 求值自带防御：任何故障（设置读取失败等）降级为空对象，不阻断 spawn
        const memoryEnv = await deps.resolveMemoryEnv(options.directory, options.workspaceId).catch((error) => {
            logger.debug('[EXECUTOR] resolveMemoryEnv failed; session continues without memory', error);
            return {};
        });

        MobiProcess = deps.spawn(args, {
            cwd: spawnDirectory,
            detached: true,  // Sessions stay alive when the executor stops
            stdio: ['ignore', 'pipe', 'pipe'],  // Capture stdout/stderr for debugging
            env: {
                ...process.env,
                ...extraEnv,
                // 宿主通道端口（ticket-21）：会话子进程必须连 loopback 宿主 listener——
                // 显式注入覆盖继承值（profile/legacy env 可能还指向主端口），不依赖 settings 猜测
                MOBI_API_URL: hostChannelUrl(deps.hostPort),
                // 记忆 env 覆盖继承值（用户 shell 自有的 HINDSIGHT_* 不得串入 mobi 挂载的记忆会话）
                ...memoryEnv,
            }
        });

        MobiProcess.stderr?.on('data', (data) => {
            stderrTail = appendTail(stderrTail, data);
        });

        let spawnErrorBeforePidCheck: Error | null = null;
        const captureSpawnErrorBeforePidCheck = (error: Error) => {
            spawnErrorBeforePidCheck = error;
        };
        MobiProcess.once('error', captureSpawnErrorBeforePidCheck);

        if (!MobiProcess.pid) {
            // Allow the async 'error' event to fire before we read it
            await new Promise((resolve) => setImmediate(resolve));
            const details = [`cwd=${spawnDirectory}`];
            if (spawnErrorBeforePidCheck) {
                details.push(formatSpawnError(spawnErrorBeforePidCheck));
            }
            const errorMessage = `Failed to spawn MOBI process - no PID returned (${details.join('; ')})`;
            logger.debug('[EXECUTOR] Failed to spawn process - no PID returned', spawnErrorBeforePidCheck ?? null);
            deps.reportOutcome?.({
                type: 'error',
                details: {
                    message: errorMessage
                }
            });
            await maybeCleanupWorktree('no-pid');
            return {
                type: 'error',
                errorMessage
            };
        }
        MobiProcess.removeListener('error', captureSpawnErrorBeforePidCheck);

        const pid = MobiProcess.pid;
        logger.debug(`[EXECUTOR] Spawned process with PID ${pid}`);
        const observed = { exitCode: null as number | null, exitSignal: null as NodeJS.Signals | null };
        const buildFailure = (reason: 'timeout' | 'exit-before-webhook' | 'process-error-before-webhook') =>
            buildWebhookFailureMessage(reason, pid, observed, stderrTail);

        const trackedSession = {
            startedBy: 'daemon' as const,
            pid,
            childProcess: MobiProcess,
            resumeSessionId: options.resumeSessionId,
            directoryCreated,
            message: directoryCreated ? `The path '${directory}' did not exist. We created a new folder and spawned a new session there.` : undefined
        };

        deps.trackingTable.registerDaemon(trackedSession);

        MobiProcess.on('exit', (code, signal) => {
            observed.exitCode = typeof code === 'number' ? code : null;
            observed.exitSignal = signal ?? null;
            logger.debug(`[EXECUTOR] Child PID ${pid} exited with code ${code}, signal ${signal}`);
            if (code !== 0 || signal) {
                logStderrTail();
            }
            deps.trackingTable.failAwaiter(pid, buildFailure('exit-before-webhook'));
            deps.trackingTable.remove(pid);
        });

        MobiProcess.on('error', (error) => {
            logger.debug('[EXECUTOR] Child process error:', error);
            deps.trackingTable.failAwaiter(pid, buildFailure('process-error-before-webhook'));
            deps.trackingTable.remove(pid);
        });

        // Wait for webhook to populate session with MobiSessionId
        logger.debug(`[EXECUTOR] Waiting for session webhook for PID ${pid}`);

        // 15 second timeout - I have seen timeouts on 10 seconds
        // even though session was still created successfully in ~2 more seconds
        const waitResult = await deps.trackingTable.waitForWebhook(pid, 15_000, () => {
            logger.debug(`[EXECUTOR] Session webhook timeout for PID ${pid}`);
            logStderrTail();
            return buildFailure('timeout');
        });
        const spawnResult: SpawnSessionResult = waitResult.ok
            ? { type: 'success', sessionId: waitResult.sessionId }
            : { type: 'error', errorMessage: waitResult.errorMessage };

        if (spawnResult.type === 'error') {
            deps.reportOutcome?.({
                type: 'error',
                details: {
                    message: spawnResult.errorMessage,
                    pid,
                    exitCode: observed.exitCode,
                    signal: observed.exitSignal
                }
            });
            await maybeCleanupWorktree('spawn-error');
        } else {
            deps.reportOutcome?.({ type: 'success' });
        }
        return spawnResult;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.debug('[EXECUTOR] Failed to spawn session:', error);
        await maybeCleanupWorktree('exception');
        deps.reportOutcome?.({
            type: 'error',
            details: {
                message: `Failed to spawn session: ${errorMessage}`
            }
        });
        return {
            type: 'error',
            errorMessage: `Failed to spawn session: ${errorMessage}`
        };
    }
}
