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

import { SpawnSessionResult } from '@mobi/shared/hostProtocol';
// 预算闸字段（acquireReason）只存在于 daemon 内部签名，不属跨进程协议（候选③）
import type { SpawnRequest } from './executorHost';
import type { GovernorAcquireReason } from './sessionGovernor';
import { logger } from '@mobi/node-core/logger';
import { hostChannelUrl } from '@mobi/node-core/hostChannel';
import { keepTail } from '@mobi/node-core/utils/keepTail';
import { buildClaudeSpawnArgs } from './spawnArgs';
import type { WorktreeInfo } from './worktree';
import type { WorktreeCleanupResult } from '../worktree/cleanup';
import type { SessionTrackingTable } from './sessionTrackingTable';
import type { SlotAcquisition } from './sessionGovernor';

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
    /** 预算闸（票 2.1）：可选注入——缺省零行为（测试假件/直跑形态不受约束）。
     *  acquire 在 dedup 之后：already-running 幂等返回不占名额。reason 来自
     *  SpawnRequest.acquireReason（user 缺省 / warm 内层防御位） */
    governor?: { acquireSlot: (reason: GovernorAcquireReason) => SlotAcquisition };
    /** 宿主通道端口（求值归 startExecutor：daemon 配置优先，直跑回退默认派生） */
    hostPort: number;
    reportOutcome?: (outcome: SpawnOutcome) => void;
    fs: {
        access(path: string): Promise<void>;
        mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
    };
    spawn: (args: string[], options: { cwd: string; detached: boolean; stdio: Array<'ignore' | 'pipe'>; env: Record<string, string | undefined> }) => SpawnedCliProcess;
    createWorktree: (input: { basePath: string; nameHint?: string }) => Promise<{ ok: true; info: WorktreeInfo } | { ok: false; error: string }>;
    /** 失败清理：干净才删、脏/未知保留（worktree-lifecycle 票 03；语义见 worktree/cleanup） */
    disposeWorktree: (input: { repoRoot: string; worktreePath: string; branch: string }) => Promise<WorktreeCleanupResult>;
    isProcessAlive: (pid: number) => boolean;
    /** 会话级记忆裁决（agent-memory 票 02；三档隔离票 05 加 workspaceId 语境）：
     *  按 workspace 目录 + spawn 的 workspaceId 求值——active 返回注入子进程的 env
     *  （MOBI_MEMORY_ENGINE + HINDSIGHT_*），降级（off/非法/排除）返回空对象。
     *  装配层负责读 daemon 设置、解析隔离规则与同步管理配置文件；求值放装配、执行放 spawn */
    resolveMemoryEnv: (workspaceDirectory: string, workspaceId: string | undefined) => Promise<Record<string, string>>;
    /** 会话遥测裁决（OpenTelemetry 设置票）：读 daemon 设置求值——enabled+endpoint 齐
     *  备返回 OTEL_* env（v1 traces-only），否则空对象。求值放装配、执行放 spawn；
     *  无参数（遥测不按 workspace 区分，全局一档） */
    resolveTelemetryEnv: () => Promise<Record<string, string>>;
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
export async function spawnSession(options: SpawnRequest, deps: SpawnSessionDeps): Promise<SpawnSessionResult> {
    logger.debugLargeJson('[EXECUTOR] Spawning session', options);

    // 唤醒去重 + 在途预约（.scratch/wake-dedup + #108 双键 + 2026-10-21 竞态收口）：
    // 同机已有活 child 属于同一会话时不再 spawn 第二个进程——resume 目标相同，或 mobi
    // 行 id 相同（在途 child 已由 webhook / 注册戳带上行 id）。命中返回 null；未命中则
    // **同步**占用本次比对键，堵住「查重 → await 目录检查/mkdir/spawn → registerDaemon」
    // 之间并发的第二次激活（两个 --resume 同 native id 的进程互相抢 socket）。
    // 「表项存在 = 进程存活」由 exit 既有清理保证；查重决策单源见 spawnDedup。
    // server 侧对 already-running 零等待幂等消费（票 02）
    const claim = deps.trackingTable.claimSpawn({
        resumeSessionId: options.resumeSessionId,
        mobiSessionId: options.sessionId,
    });
    if (!claim) {
        logger.debug('[EXECUTOR] Spawn deduped: live child already exists for this session');
        return { type: 'already-running' };
    }

    // 预算闸（票 2.1）：dedup 之后——already-running 幂等返回不占名额。reason 从
    // spawn 选项穿透（缺省 user：新建/resume/fork 激活/投递唤醒；warm-on-open 内层
    // 传 'warm'）。user 到顶走逐出降级链（永不拒绝）；warm 到顶 yield（内层防御位，
    // 正常路径外层 coordinator 闸已挡）。in-flight 覆盖到结果落定：成功时追踪表已
    // 登记（active 即时接棒），任何失败路径 finally 兜底释放，不泄漏
    const slot = deps.governor?.acquireSlot(options.acquireReason ?? 'user');
    if (slot && !slot.granted) {
        logger.debug('[EXECUTOR] Governor yielded: session capacity reached');
        claim.release();
        return { type: 'governor-yielded' };
    }
    try {
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
            // 干净才删、脏/unknown 保留（spawn 失败不再 --force 盲删未提交改动）；
            // 分支 -d 删除被拒只降级保留分支，不追杀
            const result = await deps.disposeWorktree({
                repoRoot: worktreeInfo.basePath,
                worktreePath: worktreeInfo.worktreePath,
                branch: worktreeInfo.branch
            });
            if (!result.removed) {
                logger.debug(`[EXECUTOR] Worktree kept after spawn failure (${result.state}, ${result.dirtyFileCount} dirty files): ${worktreeInfo.worktreePath}`);
                return;
            }
            if (!result.branchDeleted) {
                logger.debug(`[EXECUTOR] Worktree removed but branch kept: ${worktreeInfo.branch}${result.warning ? ` (${result.warning})` : ''}`);
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
            // 分段计时（观测落盘，2026-10-29）：spawn/dormancy 事故此前在生产不可考
            // （debug 走 console、stdout→/dev/null）。每条 spawn 一个 INFO 汇总行 +
            // 各阶段耗时，用户级事件频度，不构成日志噪音
            const spawnStartedAt = Date.now();

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
            // 遥测 env 求值（OpenTelemetry）：off/未配置返回空对象，故障降级为空对象，同样不阻断 spawn
            const telemetryEnv = await deps.resolveTelemetryEnv().catch((error) => {
                logger.debug('[EXECUTOR] resolveTelemetryEnv failed; session continues without telemetry', error);
                return {};
            });
            // preSpawn = 目录检查/worktree/args/memoryEnv 全部前置段；此后到 webhook
            // 返回是 webhookWait（子进程启动+回执，15s 上限）
            const preSpawnMs = Date.now() - spawnStartedAt;
            const spawnedAt = Date.now();

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
                    // 遥测 env 同理覆盖继承值（用户 shell 自有的 OTEL_* 不得串入 mobi 会话）
                    ...telemetryEnv,
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
                // 调用方已知行 id（唤醒/激活路径）时注册即盖戳：dedup 在 webhook 前的窗口
                // 也能按行 id 命中；webhook 到达后 applyWebhook 会用 CLI 上报值对齐
                MobiSessionId: options.sessionId,
                directoryCreated,
                registeredAt: Date.now(),
                message: directoryCreated ? `The path '${directory}' did not exist. We created a new folder and spawned a new session there.` : undefined
            };

            deps.trackingTable.registerDaemon(trackedSession);
            // 预约交接：表行已登记，去重从此刻起由追踪表接管，预约键可以释放
            claim.release();
            // 名额接棒点：追踪表已把该进程计入 active，inFlight 必须同时交还——
            // 否则 waitForWebhook（最长 15s）窗口内同一子进程被 effective 计两次，
            // 并发的第二个 spawn 会看到虚高水位、无谓逐出一个空闲会话。
            // 失败路径由 finally 兜底（release 幂等）
            slot?.release();

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
            const webhookWaitMs = Date.now() - spawnedAt;
            const totalMs = Date.now() - spawnStartedAt;
            // 结果落 INFO（成功/超时各一行，含分段耗时）：webhook 超时是「进程起了但
            // 15s 没报到」——没有这行，生产侧永远不知道慢在哪一段
            if (waitResult.ok) {
                logger.info(
                    `[EXECUTOR] spawn ok (session=${waitResult.sessionId}, pid=${pid}, ` +
                    `total=${totalMs}ms, preSpawn=${preSpawnMs}ms, webhookWait=${webhookWaitMs}ms, dir=${directory})`
                );
            } else {
                logger.warn(
                    `[EXECUTOR] spawn failed (pid=${pid}, total=${totalMs}ms, preSpawn=${preSpawnMs}ms, ` +
                    `webhookWait=${webhookWaitMs}ms, dir=${directory}): ${waitResult.errorMessage}`
                );
            }
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
    } finally {
        // 幂等：成功路径已在 registerDaemon 后交接释放，这里兜住所有失败/早退路径
        claim.release();
        slot?.release();
    }
}
