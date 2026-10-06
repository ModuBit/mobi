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
 * Runner 生命周期核心（ticket-16 拆分；ticket-22 起无独立进程入口）。
 *
 * `startRunnerCore` 只负责「起一个 runner」：锁、control server、定时自检，返回
 * `RunnerHandle`。machine 通道已删（ticket-20）：本机 machine 行由 hub 侧自注册，
 * runner 侧运行时事实（httpPort / spawn 结果 / 关停状态）经注入的
 * {@link RunnerCoreDeps.updateExecutorState} 直写。**不含任何进程级职责**——
 * exit logger、信号处理、崩溃检测由调用方承担（daemonEntry 同进程编排）。
 */

import fs from 'fs/promises';

import { TrackedSession } from './types';
import { applySessionTrackingSignal, pruneDeadTrackedSessions, type SessionTrackingSignal } from './sessionTracking';
import { RunnerState, Metadata } from '@mobi/node-core/api/types';
import { SpawnSessionOptions, SpawnSessionResult } from '@mobi/shared/hostProtocol';
import { logger } from '@mobi/node-core/logger';
import { spawnMobiCli } from '@mobi/node-core/utils/spawnMobiCli';
import { acquireRunnerLock, releaseRunnerLock } from '@mobi/node-core/persistence';
import { getConfiguration, resolveHostPort } from '../configuration';
import type { FileHandle } from 'node:fs/promises';
import { isProcessAlive, killProcess, killProcessByChildProcess } from '@mobi/node-core/utils/process';
import { startRunnerControlServer } from './controlServer';
import { buildClaudeSpawnArgs } from './spawnArgs';
import { createResumeDedupGuard } from './spawnDedup';
import { createWorktree, removeWorktree, type WorktreeInfo } from './worktree';

/** 关停来源（三类，hub 侧 runnerState.shutdownSource 透传） */
export type RunnerShutdownSource = 'mobi-cli' | 'os-signal' | 'exception';

/**
 * hub → runner 核心的会话执行桥（ticket-18）：spawn/stop 直调 + 追踪表补登。
 * spawn 契约与 controlServer /spawn-session 曾完全同源（同一份 spawnSession
 * 闭包）；该端点已随 machine 通道删除（ticket-20），spawn 唯一入口是本桥。
 */
export interface RunnerSessionBridge {
    spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>
    stopSession: (sessionId: string) => boolean
    /** 追踪补登/刷新（Q8）：决策单源见 sessionTracking.applySessionTrackingSignal */
    registerSessionTracking: (signal: SessionTrackingSignal) => void
}

/** runner 句柄：stop 只做组件级清理，不碰进程（不 process.exit、不挂信号） */
export interface RunnerHandle {
    /** control server 端口（daemon.state.json / runner.state.json 记录用） */
    httpPort: number
    /**
     * 会话执行桥（ticket-18）：hub 侧 LocalMachineHost 直调本 runner 核心的
     * spawn/stop/追踪表，绕过 socket loopback。daemon 编排在 runner 就绪后
     * 经 HubHandle.setRunnerBridge 注入。
     */
    bridge: RunnerSessionBridge
    /**
     * 优雅关停（幂等）。清理顺序沿用原 cleanupAndShutdown：停心跳 → 上报
     * shutting-down → 停 control server → 清 state → 释放锁。
     * **不杀 detached 会话子进程**（现状语义：runner 停止时会话存活）。
     */
    stop(source: RunnerShutdownSource, errorMessage?: string): Promise<void>
    /**
     * 内部关停请求（control server 的 shutdown 指令 / 心跳自杀检查）完成时
     * resolve——薄壳据此退出进程。外部 stop() 触发的关停同样兑现此 promise。
     */
    exited: Promise<{ source: RunnerShutdownSource; errorMessage?: string }>
}

/**
 * daemon 编排注入的 hub 侧能力（ticket-20）：machine 通道删除后，runner 运行时
 * 事实直写 hub（同进程）。缺省（standalone `runner start-sync`）时静默跳过——
 * 该形态本就不连 hub。
 */
export interface RunnerCoreDeps {
    /** 本机 runnerState 直写（spawn 结果上报 / httpPort / 关停状态） */
    updateExecutorState: (handler: (state: RunnerState | null) => RunnerState) => void
}

/** 锁已被占用：另一 runner 实例在跑（薄壳据此静默退出，非错误） */
export class RunnerLockHeldError extends Error {
    constructor() {
        super('Runner lock file already held, another runner is running');
        this.name = 'RunnerLockHeldError';
    }
}

/**
 * 会话子进程的宿主端口求值：daemon 进程内（startRunnerCore 经 daemonEntry 编排）用
 * daemon 配置（hub 已初始化，含 listenPort 派生）；standalone runner（退化形态，配置
 * 未初始化）回退 env/默认派生——与 node-core CLI 侧默认 12222 对齐
 */
function resolveSpawnHostPort(): number {
    try {
        return getConfiguration().hostPort
    } catch {
        return resolveHostPort(2222)
    }
}

export async function startRunnerCore(deps?: RunnerCoreDeps): Promise<RunnerHandle> {
  // Acquire exclusive lock (proves runner is running)
  const runnerLockHandle: FileHandle | null = await acquireRunnerLock(5, 200);
  if (!runnerLockHandle) {
    throw new RunnerLockHeldError();
  }

  // Setup state - key by PID
  const pidToTrackedSession = new Map<number, TrackedSession>();

  // Session spawning awaiter system
  const pidToAwaiter = new Map<number, (session: TrackedSession) => void>();
  const pidToErrorAwaiter = new Map<number, (errorMessage: string) => void>();
  type SpawnFailureDetails = {
    message: string
    pid?: number
    exitCode?: number | null
    signal?: NodeJS.Signals | null
  };
  let reportSpawnOutcomeToHub: ((outcome: { type: 'success' } | { type: 'error'; details: SpawnFailureDetails }) => void) | null = null;
  const formatSpawnError = (error: unknown): string => {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  };

  // Helper functions
  const getCurrentChildren = () => Array.from(pidToTrackedSession.values());

  // Handle webhook from MOBI session reporting itself
  const onMobiSessionWebhook = (sessionId: string, sessionMetadata: Metadata) => {
    logger.debugLargeJson(`[RUNNER RUN] Session reported`, sessionMetadata);

    const pid = sessionMetadata.hostPid;
    if (!pid) {
      logger.debug(`[RUNNER RUN] Session webhook missing hostPid for sessionId: ${sessionId}`);
      return;
    }

    logger.debug(`[RUNNER RUN] Session webhook: ${sessionId}, PID: ${pid}, started by: ${sessionMetadata.startedBy || 'unknown'}`);
    logger.debug(`[RUNNER RUN] Current tracked sessions before webhook: ${Array.from(pidToTrackedSession.keys()).join(', ')}`);

    // Check if we already have this PID (runner-spawned)
    const existingSession = pidToTrackedSession.get(pid);

    if (existingSession && existingSession.startedBy === 'runner') {
      // Update runner-spawned session with reported data
      existingSession.MobiSessionId = sessionId;
      existingSession.MobiSessionMetadataFromLocalWebhook = sessionMetadata;
      logger.debug(`[RUNNER RUN] Updated runner-spawned session ${sessionId} with metadata`);

      // Resolve any awaiter for this PID
      const awaiter = pidToAwaiter.get(pid);
      if (awaiter) {
        pidToAwaiter.delete(pid);
        pidToErrorAwaiter.delete(pid);
        awaiter(existingSession);
        logger.debug(`[RUNNER RUN] Resolved session awaiter for PID ${pid}`);
      }
    } else if (!existingSession) {
      // New session started externally
      const trackedSession: TrackedSession = {
        startedBy: 'mobi directly - likely by user from terminal',
        MobiSessionId: sessionId,
        MobiSessionMetadataFromLocalWebhook: sessionMetadata,
        pid
      };
      pidToTrackedSession.set(pid, trackedSession);
      logger.debug(`[RUNNER RUN] Registered externally-started session ${sessionId}`);
    }
  };

  // Spawn a new session (sessionId reserved for future --resume functionality)
  const spawnSession = async (options: SpawnSessionOptions): Promise<SpawnSessionResult> => {
    logger.debugLargeJson('[RUNNER RUN] Spawning session', options);

    // 唤醒去重（.scratch/wake-dedup）：同机已有活 child 以相同 resume 目标拉起时
    // 不再 spawn 第二个进程。「表项存在 = 进程存活」由 exit 既有清理保证；查重
    // 决策与结果构造单源见 spawnDedup。hub 侧对 already-running 零等待幂等消费（票 02）
    const dedupGuard = createResumeDedupGuard(pidToTrackedSession);
    const dedupHit = dedupGuard(options.resumeSessionId);
    if (dedupHit) {
      logger.debug('[RUNNER RUN] Spawn deduped: live child already resuming this session');
      return dedupHit;
    }

    const { directory, approvedNewDirectoryCreation = true } = options;
    const sessionType = options.sessionType ?? 'simple';
    const worktreeName = options.worktreeName;
    let directoryCreated = false;
    let spawnDirectory = directory;
    let worktreeInfo: WorktreeInfo | null = null;
    let MobiProcess: ReturnType<typeof spawnMobiCli> | null = null;

    // 判断directory是否存在，如果不存在则尝试创建
    if (sessionType === 'simple') {
      try {
        await fs.access(directory);
        logger.debug(`[RUNNER RUN] Directory exists: ${directory}`);
      } catch (_error) {
        logger.debug(`[RUNNER RUN] Directory doesn't exist, creating: ${directory}`);

        // Check if directory creation is approved
        if (!approvedNewDirectoryCreation) {
          logger.debug(`[RUNNER RUN] Directory creation not approved for: ${directory}`);
          return {
            type: 'requestToApproveDirectoryCreation',
            directory
          };
        }

        try {
          await fs.mkdir(directory, { recursive: true });
          logger.debug(`[RUNNER RUN] Successfully created directory: ${directory}`);
          directoryCreated = true;
        } catch (mkdirError: unknown) {
          const errno = mkdirError as NodeJS.ErrnoException;
          let errorMessage = `Unable to create directory at '${directory}'. `;

          // Provide more helpful error messages based on the error code
          if (errno.code === 'EACCES') {
            errorMessage += `Permission denied. You don't have write access to create a folder at this location. Try using a different path or check your permissions.`;
          } else if (errno.code === 'ENOTDIR') {
            errorMessage += `A file already exists at this path or in the parent path. Cannot create a directory here. Please choose a different location.`;
          } else if (errno.code === 'ENOSPC') {
            errorMessage += `No space left on device. Your disk is full. Please free up some space and try again.`;
          } else if (errno.code === 'EROFS') {
            errorMessage += `The file system is read-only. Cannot create directories here. Please choose a writable location.`;
          } else {
            const errStr = errno.message || String(mkdirError);
            errorMessage += `System error: ${errStr}. Please verify the path is valid and you have the necessary permissions.`;
          }

          logger.debug(`[RUNNER RUN] Directory creation failed: ${errorMessage}`);
          return {
            type: 'error',
            errorMessage
          };
        }
      }
    } else {
      try {
        await fs.access(directory);
        logger.debug(`[RUNNER RUN] Worktree base directory exists: ${directory}`);
      } catch (_error) {
        logger.debug(`[RUNNER RUN] Worktree base directory missing: ${directory}`);
        return {
          type: 'error',
          errorMessage: `Worktree sessions require an existing Git repository. Directory not found: ${directory}`
        };
      }
    }

    // 尝试创建worktree
    if (sessionType === 'worktree') {
      const worktreeResult = await createWorktree({
        basePath: directory,
        nameHint: worktreeName
      });
      if (!worktreeResult.ok) {
        logger.debug(`[RUNNER RUN] Worktree creation failed: ${worktreeResult.error}`);
        return {
          type: 'error',
          errorMessage: worktreeResult.error
        };
      }
      worktreeInfo = worktreeResult.info;
      spawnDirectory = worktreeInfo.worktreePath;
      logger.debug(`[RUNNER RUN] Created worktree ${worktreeInfo.worktreePath} (branch ${worktreeInfo.branch})`);
    }

    const cleanupWorktree = async () => {
      if (!worktreeInfo) {
        return;
      }
      const result = await removeWorktree({
        repoRoot: worktreeInfo.basePath,
        worktreePath: worktreeInfo.worktreePath
      });
      if (!result.ok) {
        logger.debug(`[RUNNER RUN] Failed to remove worktree ${worktreeInfo.worktreePath}: ${result.error}`);
      }
    };
    const maybeCleanupWorktree = async (reason: string) => {
      if (!worktreeInfo) {
        return;
      }
      const pid = MobiProcess?.pid;
      if (pid && isProcessAlive(pid)) {
        logger.debug(`[RUNNER RUN] Skipping worktree cleanup after ${reason}; child still running`, {
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

      // sessionId reserved for future use
      const MAX_TAIL_CHARS = 4000;
      let stderrTail = '';
      const appendTail = (current: string, chunk: Buffer | string): string => {
        const text = chunk.toString();
        if (!text) {
          return current;
        }
        const combined = current + text;
        return combined.length > MAX_TAIL_CHARS ? combined.slice(-MAX_TAIL_CHARS) : combined;
      };
      const logStderrTail = () => {
        const trimmed = stderrTail.trim();
        if (!trimmed) {
          return;
        }
        logger.debug('[RUNNER RUN] Child stderr tail', trimmed);
      };

      MobiProcess = spawnMobiCli(args, {
        cwd: spawnDirectory,
        detached: true,  // Sessions stay alive when runner stops
        stdio: ['ignore', 'pipe', 'pipe'],  // Capture stdout/stderr for debugging
        env: {
          ...process.env,
          ...extraEnv,
          // 宿主通道端口（ticket-21）：会话子进程必须连 loopback 宿主 listener——
          // 显式注入覆盖继承值（profile/legacy env 可能还指向主端口），不依赖 settings 猜测
          MOBI_API_URL: `http://127.0.0.1:${resolveSpawnHostPort()}`
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
        logger.debug('[RUNNER RUN] Failed to spawn process - no PID returned', spawnErrorBeforePidCheck ?? null);
        reportSpawnOutcomeToHub?.({
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
      logger.debug(`[RUNNER RUN] Spawned process with PID ${pid}`);
      let observedExitCode: number | null = null;
      let observedExitSignal: NodeJS.Signals | null = null;
      const buildWebhookFailureMessage = (reason: 'timeout' | 'exit-before-webhook' | 'process-error-before-webhook'): string => {
        let message: string;
        if (reason === 'exit-before-webhook') {
          message = `Session process exited before webhook for PID ${pid}`;
        } else if (reason === 'process-error-before-webhook') {
          message = `Session process error before webhook for PID ${pid}`;
        } else {
          message = `Session webhook timeout for PID ${pid}`;
        }

        if (observedExitCode !== null || observedExitSignal) {
          if (observedExitCode !== null) {
            message += ` (exit code ${observedExitCode})`;
          } else {
            message += ` (signal ${observedExitSignal})`;
          }
        }

        const trimmedTail = stderrTail.trim();
        if (trimmedTail) {
          const compactTail = trimmedTail.replace(/\s+/g, ' ');
          const tailForMessage = compactTail.length > 800 ? compactTail.slice(-800) : compactTail;
          message += `. stderr: ${tailForMessage}`;
        }

        return message;
      };

      const trackedSession: TrackedSession = {
        startedBy: 'runner',
        pid,
        childProcess: MobiProcess,
        resumeSessionId: options.resumeSessionId,
        directoryCreated,
        message: directoryCreated ? `The path '${directory}' did not exist. We created a new folder and spawned a new session there.` : undefined
      };

      pidToTrackedSession.set(pid, trackedSession);

      MobiProcess.on('exit', (code, signal) => {
        observedExitCode = typeof code === 'number' ? code : null;
        observedExitSignal = signal ?? null;
        logger.debug(`[RUNNER RUN] Child PID ${pid} exited with code ${code}, signal ${signal}`);
        if (code !== 0 || signal) {
          logStderrTail();
        }
        const errorAwaiter = pidToErrorAwaiter.get(pid);
        if (errorAwaiter) {
          pidToErrorAwaiter.delete(pid);
          pidToAwaiter.delete(pid);
          errorAwaiter(buildWebhookFailureMessage('exit-before-webhook'));
        }
        onChildExited(pid);
      });

      MobiProcess.on('error', (error) => {
        logger.debug('[RUNNER RUN] Child process error:', error);
        const errorAwaiter = pidToErrorAwaiter.get(pid);
        if (errorAwaiter) {
          pidToErrorAwaiter.delete(pid);
          pidToAwaiter.delete(pid);
          errorAwaiter(buildWebhookFailureMessage('process-error-before-webhook'));
        }
        onChildExited(pid);
      });

      // Wait for webhook to populate session with MobiSessionId
      logger.debug(`[RUNNER RUN] Waiting for session webhook for PID ${pid}`);

      const spawnResult = await new Promise<SpawnSessionResult>((resolve) => {
        // Set timeout for webhook
        const timeout = setTimeout(() => {
          pidToAwaiter.delete(pid);
          pidToErrorAwaiter.delete(pid);
          logger.debug(`[RUNNER RUN] Session webhook timeout for PID ${pid}`);
          logStderrTail();
          resolve({
            type: 'error',
            errorMessage: buildWebhookFailureMessage('timeout')
          });
          // 15 second timeout - I have seen timeouts on 10 seconds
          // even though session was still created successfully in ~2 more seconds
        }, 15_000);

        // Register awaiter
        pidToAwaiter.set(pid, (completedSession) => {
          clearTimeout(timeout);
          pidToErrorAwaiter.delete(pid);
          logger.debug(`[RUNNER RUN] Session ${completedSession.MobiSessionId} fully spawned with webhook`);
          resolve({
            type: 'success',
            sessionId: completedSession.MobiSessionId!
          });
        });
        pidToErrorAwaiter.set(pid, (errorMessage) => {
          clearTimeout(timeout);
          resolve({
            type: 'error',
            errorMessage
          });
        });
      });
      if (spawnResult.type === 'error') {
        reportSpawnOutcomeToHub?.({
          type: 'error',
          details: {
            message: spawnResult.errorMessage,
            pid,
            exitCode: observedExitCode,
            signal: observedExitSignal
          }
        });
        await maybeCleanupWorktree('spawn-error');
      } else {
        reportSpawnOutcomeToHub?.({ type: 'success' });
      }
      return spawnResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.debug('[RUNNER RUN] Failed to spawn session:', error);
      await maybeCleanupWorktree('exception');
      reportSpawnOutcomeToHub?.({
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
  };

  // Stop a session by sessionId or PID fallback
  const stopSession = (sessionId: string): boolean => {
    logger.debug(`[RUNNER RUN] Attempting to stop session ${sessionId}`);

    // Try to find by sessionId first
    for (const [pid, session] of pidToTrackedSession.entries()) {
      if (session.MobiSessionId === sessionId ||
        (sessionId.startsWith('PID-') && pid === parseInt(sessionId.replace('PID-', '')))) {

        if (session.startedBy === 'runner' && session.childProcess) {
          try {
            void killProcessByChildProcess(session.childProcess);
            logger.debug(`[RUNNER RUN] Requested termination for runner-spawned session ${sessionId}`);
          } catch (error) {
            logger.debug(`[RUNNER RUN] Failed to kill session ${sessionId}:`, error);
          }
        } else {
          // For externally started sessions, try to kill by PID
          try {
            void killProcess(pid);
            logger.debug(`[RUNNER RUN] Requested termination for external session PID ${pid}`);
          } catch (error) {
            logger.debug(`[RUNNER RUN] Failed to kill external session PID ${pid}`, error);
          }
        }

        pidToTrackedSession.delete(pid);
        logger.debug(`[RUNNER RUN] Removed session ${sessionId} from tracking`);
        return true;
      }
    }

    logger.debug(`[RUNNER RUN] Session ${sessionId} not found`);
    return false;
  };

  // Handle child process exit
  const onChildExited = (pid: number) => {
    logger.debug(`[RUNNER RUN] Removing exited process PID ${pid} from tracking`);
    pidToTrackedSession.delete(pid);
    pidToAwaiter.delete(pid);
    pidToErrorAwaiter.delete(pid);
  };

  // 关停请求（一次性）：内部触发（control server 指令 / 心跳自杀）与外部
  // handle.stop() 汇聚到同一份清理，exited promise 兑现后薄壳退出进程
  let shutdownRequest: Promise<unknown> | null = null;
  let resolveExited: ((value: { source: RunnerShutdownSource; errorMessage?: string }) => void) | null = null;
  const exited = new Promise<{ source: RunnerShutdownSource; errorMessage?: string }>((resolve) => {
    resolveExited = resolve;
  });
  const requestShutdown = (source: RunnerShutdownSource, errorMessage?: string) => {
    logger.debug(`[RUNNER RUN] Requesting shutdown (source: ${source}, errorMessage: ${errorMessage})`);
    if (resolveExited) {
      resolveExited({ source, errorMessage });
      resolveExited = null;
    }
  };

  // Start control server
  const { port: controlPort, stop: stopControlServer } = await startRunnerControlServer({
    getChildren: getCurrentChildren,
    stopSession,
    requestShutdown: () => requestShutdown('mobi-cli'),
    onMobiSessionWebhook
  });

  // 本机 machine 行由 hub 侧自注册（ticket-20：machine 通道删除，daemon 即本机）；
  // runner 这里只补 control server 端口等运行时事实（httpPort 在 hub 注册时未知）
  deps?.updateExecutorState((state: RunnerState | null) => ({
    ...(state ?? { status: 'running' }),
    status: 'running',
    pid: process.pid,
    httpPort: controlPort,
    startedAt: state?.startedAt ?? Date.now(),
  }));
  logger.debug('[RUNNER RUN] Runner state reported (local machine channel)');

  reportSpawnOutcomeToHub = (outcome) => {
    void deps?.updateExecutorState((state: RunnerState | null) => {
      const baseState: RunnerState = state
        ? { ...state }
        : { status: 'running' };

      if (typeof baseState.pid !== 'number') {
        baseState.pid = process.pid;
      }
      if (typeof baseState.httpPort !== 'number') {
        baseState.httpPort = controlPort;
      }
      if (typeof baseState.startedAt !== 'number') {
        baseState.startedAt = Date.now();
      }

      if (outcome.type === 'success') {
        return {
          ...baseState,
          lastSpawnError: null
        };
      }

      return {
        ...baseState,
        lastSpawnError: {
          message: outcome.details.message,
          pid: outcome.details.pid,
          exitCode: outcome.details.exitCode ?? null,
          signal: outcome.details.signal ?? null,
          at: Date.now()
        }
      };
    });
  };

  // 定时自检（间隔沿用 MOBI_RUNNER_HEARTBEAT_INTERVAL）：
  // 清理已死会话的追踪行（决策单源在 sessionTracking.pruneDeadTrackedSessions）。
  // 旧职责退役（ticket-22）：二进制 mtime 自重启删除（与 supervisor restart 重叠，
  // 升级路径由 upgrader/processRestarter 走 service restart 替换整个 daemon）；
  // runner.state.json 心跳停写（daemon.state.json 由 daemonEntry 维护，读取方已迁移）
  const heartbeatIntervalMs = parseInt(process.env.MOBI_RUNNER_HEARTBEAT_INTERVAL || '60000');
  const pruneStaleSessionsInterval = setInterval(() => {
    for (const pid of pruneDeadTrackedSessions(pidToTrackedSession, isProcessAlive)) {
      logger.debug(`[RUNNER RUN] Removing stale session with PID ${pid} (process no longer exists)`);
    }
  }, heartbeatIntervalMs);

  // 优雅清理（幂等）：清理顺序与原 cleanupAndShutdown 一致，只是不再 process.exit
  const cleanup = async (source: RunnerShutdownSource, errorMessage?: string) => {
    logger.debug(`[RUNNER RUN] Starting proper cleanup (source: ${source}, errorMessage: ${errorMessage})...`);

    // Clear prune interval
    clearInterval(pruneStaleSessionsInterval);
    logger.debug('[RUNNER RUN] Prune interval cleared');

    // Update runner state before shutting down（同步直写，无需等待发送窗口）
    deps?.updateExecutorState((state: RunnerState | null) => ({
      ...state,
      status: 'shutting-down',
      shutdownRequestedAt: Date.now(),
      shutdownSource: source
    }));

    await stopControlServer();
    await releaseRunnerLock(runnerLockHandle);

    logger.debug('[RUNNER RUN] Cleanup completed');
  };

  // hub 直调桥（ticket-18）：spawn/stop 复用本闭包内实现；追踪补登单源在 sessionTracking
  const bridge: RunnerSessionBridge = {
    spawnSession,
    stopSession,
    registerSessionTracking: (signal) => {
      const outcome = applySessionTrackingSignal(pidToTrackedSession, signal, isProcessAlive);
      logger.debug(`[RUNNER RUN] Session tracking signal ${signal.sessionId}: ${outcome.op}${outcome.op === 'skip' ? ` (${outcome.reason})` : ''}`);
    },
  };

  const handle: RunnerHandle = {
    httpPort: controlPort,
    bridge,
    stop: async (source, errorMessage) => {
      requestShutdown(source, errorMessage);
      if (!shutdownRequest) {
        shutdownRequest = cleanup(source, errorMessage);
      }
      await shutdownRequest;
    },
    exited,
  };

  // 内部关停请求（control server 指令 / 心跳自杀）：挂起清理，薄壳 await exited 退出
  void exited.then(({ source, errorMessage }) => {
    if (!shutdownRequest) {
      shutdownRequest = cleanup(source, errorMessage);
    }
  });

  logger.debug('[RUNNER RUN] Runner started successfully, waiting for shutdown request');

  return handle;
}
