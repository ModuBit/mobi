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
 * 会话执行器（executor）生命周期核心（ticket-16 拆分；无独立进程入口）。
 *
 * `startExecutor` 只负责「起一个执行器」：锁、control server、定时自检，返回
 * `ExecutorHandle`。运行时事实（controlPort / spawn 结果 / 关停状态）经注入的
 * {@link ExecutorCoreDeps.updateExecutorState} 直写同进程 server。**不含任何
 * 进程级职责**——exit logger、信号处理、崩溃检测由调用方承担（daemonEntry 同进程编排）。
 */

import fs from 'fs/promises';

import { ExecutorState, Metadata } from '@mobi/node-core/api/types';
import { SpawnSessionOptions, SpawnSessionResult } from '@mobi/shared/hostProtocol';
import { logger } from '@mobi/node-core/logger';
import { spawnMobiCli } from '@mobi/node-core/utils/spawnMobiCli';
import { acquireDaemonLock, releaseDaemonLock } from '@mobi/node-core/persistence';
import { getConfiguration } from '../configuration';
import { DEFAULT_LISTEN_PORT, resolveHostPort } from '@mobi/node-core/hostChannel';
import type { FileHandle } from 'node:fs/promises';
import { isProcessAlive, killProcess, killProcessByChildProcess } from '@mobi/node-core/utils/process';
import { startExecutorControlServer } from './controlServer';
import { createWorktree, removeWorktree } from './worktree';
import { SessionTrackingTable } from './sessionTrackingTable';
import { spawnSession as runSpawnSession, type SpawnOutcome } from './spawnSession';
import type { SessionTrackingSignal } from './sessionTracking';
import { ShutdownLatch } from './shutdownLatch';

/** 关停来源（三类，server 侧 executorState.shutdownSource 透传） */
export type ExecutorShutdownSource = 'mobi-cli' | 'os-signal' | 'exception';

/**
 * server → executor 核心的会话执行桥（ticket-18）：spawn/stop 直调 + 追踪表补登。
 * spawn 契约与 controlServer /spawn-session 曾完全同源（同一份 spawnSession
 * 闭包）；该端点已随 machine 通道删除（ticket-20），spawn 唯一入口是本桥。
 */
export interface ExecutorBridge {
    spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>
    stopSession: (sessionId: string) => boolean
    /** 追踪补登/刷新（Q8）：决策单源见 sessionTracking.applySessionTrackingSignal */
    registerSessionTracking: (signal: SessionTrackingSignal) => void
}

/** executor 句柄：stop 只做组件级清理，不碰进程（不 process.exit、不挂信号） */
export interface ExecutorHandle {
    /** control server 端口（daemon.state.json 的 controlPort 记录用） */
    httpPort: number
    /**
     * 会话执行桥（ticket-18）：server 侧 LocalExecutor 直调本核心的
     * spawn/stop/追踪表，绕过 socket loopback。daemon 编排在 executor 就绪后
     * 经 ServerHandle.setExecutorBridge 注入。
     */
    bridge: ExecutorBridge
    /**
     * 优雅关停（幂等）。清理顺序沿用原 cleanupAndShutdown：停心跳 → 上报
     * shutting-down → 停 control server → 清 state → 释放锁。
     * **不杀 detached 会话子进程**（现状语义：executor 停止时会话存活）。
     */
    stop(source: ExecutorShutdownSource, errorMessage?: string): Promise<void>
    /**
     * 内部关停请求（control server 的 shutdown 指令 / 心跳自杀检查）完成时
     * resolve——薄壳据此退出进程。外部 stop() 触发的关停同样兑现此 promise。
     */
    exited: Promise<{ source: ExecutorShutdownSource; errorMessage?: string }>
}

/**
 * daemon 编排注入的 server 侧能力（ticket-20）：machine 通道删除后，executor 运行时
 * 事实直写同进程 server。
 */
export interface ExecutorCoreDeps {
    /** 本机 runnerState 直写（spawn 结果上报 / httpPort / 关停状态） */
    updateExecutorState: (handler: (state: ExecutorState | null) => ExecutorState) => void
}

/** 锁已被占用：另一 executor 实例在跑（daemonEntry 据此停服退出，非错误） */
export class ExecutorLockHeldError extends Error {
    constructor() {
        super('Executor lock file already held, another executor is running');
        this.name = 'ExecutorLockHeldError';
    }
}

/**
 * 会话子进程的宿主端口求值：daemon 进程内（startExecutor 经 daemonEntry 编排）用
 * daemon 配置（server 已初始化，含派生后的 hostPort）；直跑形态（配置未初始化）
 * 回退单源默认派生（@mobi/node-core/hostChannel）
 */
function resolveSpawnHostPort(): number {
    try {
        return getConfiguration().hostPort
    } catch {
        return resolveHostPort(DEFAULT_LISTEN_PORT)
    }
}

export async function startExecutor(deps?: ExecutorCoreDeps): Promise<ExecutorHandle> {
  // Acquire exclusive lock (proves the executor is running)
  const daemonLockHandle: FileHandle | null = await acquireDaemonLock(5, 200);
  if (!daemonLockHandle) {
    throw new ExecutorLockHeldError();
  }

  // 追踪表（架构评审候选⑧票①）：会话行与 spawn 等待端的单一持有者
  const trackingTable = new SessionTrackingTable();
  type SpawnFailureDetails = {
    message: string
    pid?: number
    exitCode?: number | null
    signal?: NodeJS.Signals | null
  };
  let reportSpawnOutcomeToHub: ((outcome: { type: 'success' } | { type: 'error'; details: SpawnFailureDetails }) => void) | null = null;
  const getCurrentChildren = () => trackingTable.all();

  // Handle webhook from MOBI session reporting itself
  const onMobiSessionWebhook = (sessionId: string, sessionMetadata: Metadata) => {
    trackingTable.applyWebhook(sessionId, sessionMetadata);
  };

  // 会话 spawn 编排（架构评审候选⑧票②）：主体提升为模块级 spawnSession
  // （executor/spawnSession.ts，依赖注入可假件驱动）；reportOutcome 闭包引用后置
  // 装配的 reportSpawnOutcomeToHub（controlServer 起来前可空）
  const spawnDeps = {
    trackingTable,
    hostPort: resolveSpawnHostPort(),
    reportOutcome: (outcome: SpawnOutcome) => { reportSpawnOutcomeToHub?.(outcome); },
    fs,
    spawn: spawnMobiCli,
    createWorktree,
    removeWorktree,
    isProcessAlive,
  };
  const spawnSession = (options: SpawnSessionOptions) => runSpawnSession(options, spawnDeps);
  // Stop a session by sessionId or PID fallback
  const stopSession = (sessionId: string): boolean => {
    logger.debug(`[EXECUTOR] Attempting to stop session ${sessionId}`);

    // Try to find by sessionId first
    for (const session of trackingTable.all()) {
      const pid = session.pid;
      if (session.MobiSessionId === sessionId ||
        (sessionId.startsWith('PID-') && pid === parseInt(sessionId.replace('PID-', '')))) {

        if (session.startedBy === 'daemon' && session.childProcess) {
          try {
            void killProcessByChildProcess(session.childProcess);
            logger.debug(`[EXECUTOR] Requested termination for executor-spawned session ${sessionId}`);
          } catch (error) {
            logger.debug(`[EXECUTOR] Failed to kill session ${sessionId}:`, error);
          }
        } else {
          // For externally started sessions, try to kill by PID
          try {
            void killProcess(pid);
            logger.debug(`[EXECUTOR] Requested termination for external session PID ${pid}`);
          } catch (error) {
            logger.debug(`[EXECUTOR] Failed to kill external session PID ${pid}`, error);
          }
        }

        trackingTable.remove(pid);
        logger.debug(`[EXECUTOR] Removed session ${sessionId} from tracking`);
        return true;
      }
    }

    logger.debug(`[EXECUTOR] Session ${sessionId} not found`);
    return false;
  };

  // 关停闩（架构评审候选⑧票①）：关停请求一次性汇聚（内部 control 指令与外部
  // handle.stop 同一份清理）；清理体经函数声明提升引用后置装配（controlServer/interval）
  const shutdownLatch = new ShutdownLatch<ExecutorShutdownSource>((source, errorMessage) => doCleanup(source, errorMessage));

  // Start control server
  const { port: controlPort, stop: stopControlServer } = await startExecutorControlServer({
    getChildren: getCurrentChildren,
    stopSession,
    requestShutdown: () => shutdownLatch.shutdown('mobi-cli'),
    onMobiSessionWebhook
  });

  // machine 通道删除后（ticket-20）executor 与 server 同进程；
  // 这里只补 control server 端口等运行时事实（server 装配时未知）
  deps?.updateExecutorState((state: ExecutorState | null) => ({
    ...(state ?? { status: 'running' }),
    status: 'running',
    pid: process.pid,
    httpPort: controlPort,
    startedAt: state?.startedAt ?? Date.now(),
  }));
  logger.debug('[EXECUTOR] Executor state reported (in-process direct write)');

  reportSpawnOutcomeToHub = (outcome) => {
    void deps?.updateExecutorState((state: ExecutorState | null) => {
      const baseState: ExecutorState = state
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
  // 历史 runner.state.json 心跳停写（daemon.state.json 由 daemonEntry 维护，读取方已迁移）
  const heartbeatIntervalMs = parseInt(process.env.MOBI_RUNNER_HEARTBEAT_INTERVAL || '60000');
  const pruneStaleSessionsInterval = setInterval(() => {
    for (const pid of trackingTable.pruneDead()) {
      logger.debug(`[EXECUTOR] Removing stale session with PID ${pid} (process no longer exists)`);
    }
  }, heartbeatIntervalMs);

  // 优雅清理（幂等，由 ShutdownLatch 保证只跑一次）：清理顺序与原 cleanupAndShutdown 一致，
  // 只是不再 process.exit。必须是函数声明（提升）：ShutdownLatch 构造时即引用，
  // 而 stopControlServer / interval 在其后装配
  async function doCleanup(source: ExecutorShutdownSource, errorMessage?: string) {
    logger.debug(`[EXECUTOR] Starting proper cleanup (source: ${source}, errorMessage: ${errorMessage})...`);

    // Clear prune interval
    clearInterval(pruneStaleSessionsInterval);
    logger.debug('[EXECUTOR] Prune interval cleared');

    // Update executor state before shutting down（同步直写，无需等待发送窗口）
    deps?.updateExecutorState((state: ExecutorState | null) => ({
      ...state,
      status: 'shutting-down',
      shutdownRequestedAt: Date.now(),
      shutdownSource: source
    }));

    await stopControlServer();
    // 持锁必非空（获取失败在 startExecutor 顶部已 throw）；函数声明提升不继承
    // const 的控制流收窄，需显式收窄
    await releaseDaemonLock(daemonLockHandle as FileHandle);

    logger.debug('[EXECUTOR] Cleanup completed');
  }

  // server 直调桥（ticket-18）：spawn/stop 复用本闭包内实现；追踪补登单源在 sessionTracking
  const bridge: ExecutorBridge = {
    spawnSession,
    stopSession,
    registerSessionTracking: (signal) => {
      trackingTable.applySignal(signal);
    },
  };

  const handle: ExecutorHandle = {
    httpPort: controlPort,
    bridge,
    stop: (source, errorMessage) => shutdownLatch.shutdown(source, errorMessage),
    exited: shutdownLatch.exited,
  };

  logger.debug('[EXECUTOR] Executor started successfully, waiting for shutdown request');

  return handle;
}
