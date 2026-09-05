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
 * Minimal persistence functions for Mobi CLI
 *
 * Handles settings, encryption key, and runner state storage in ~/.mobi/ (or MOBI_HOME override)
 */

import { FileHandle } from 'node:fs/promises'
import { readFile, writeFile, mkdir, open, unlink, rename, stat } from 'node:fs/promises'
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { configuration } from '@/configuration'
import { isProcessAlive } from '@/utils/process';
import type { WebToolsConfig } from '@mobi/shared'

export interface Settings {
  // This ID is used as the actual database ID on the server
  // All machine operations use this ID
  machineId?: string
  // cli 的连接凭证（`mobi auth login` 写入，随 cli 部署位置走）；
  // hub 侧验证基准存 settings.hub.json，两份语义独立
  cliApiToken?: string
  // API URL for server connections (priority: env MOBI_API_URL > this > default)
  apiUrl?: string
  // Legacy field name (for migration, read-only)
  serverUrl?: string
  // 超时配置
  disconnectTimeoutMs?: number   // 连接断开超时
  idleTimeoutMs?: number         // 交互不活跃超时
  timeoutWarningMs?: number      // 预警提前时间
  // 升级 channel: 'stable' | 'rc'，默认 'stable'
  updateChannel?: 'stable' | 'rc'
  // 注入给 claude 子进程的额外环境变量（优先级高于 process.env 与内置开关）
  // 由 buildClaudeFeatureEnv 合并进 sdkOptions.env，用户可在 settings.cli.json 自由扩展
  claudeEnv?: Record<string, string>
  // !bash 命令本地执行后，是否把命令+输出作为隐藏上下文注入 SDK，让模型感知并响应。
  // true（默认）= 注入即响应（等同 Claude CLI 的 respondToBashCommands:true）；
  // false = 仅本地执行、UI 展示合成工具对，模型完全不参与（!cmd 不耗 token）。
  bashInjectContext?: boolean
  // web 工具配置（provider 启停/凭据/当前选择），由 runner RPC 读写；会话进程 mtime 惰性读
  webTools?: WebToolsConfig
}

/** hub 设置文件受限写形状：cli 只允许写 listen*（hub 监听配置），其余字段归 hub 所有 */
export interface HubListenSettings {
  listenHost?: string
  listenPort?: number
}

const defaultSettings: Settings = {}

/**
 * Runner state persisted locally (different from API RunnerState)
 * This is written to disk by the runner to track its local process state
 */
export interface RunnerLocallyPersistedState {
  pid: number;
  httpPort: number;
  startTime: string;
  startedWithCliVersion: string;
  startedWithCliMtimeMs?: number;
  lastHeartbeat?: string;
  runnerLogPath?: string;
}

/**
 * Hub 状态持久化
 * Hub 启动时写入，关闭时清理，用于 CLI status/stop 子命令
 */
export interface HubLocallyPersistedState {
  pid: number;
  listenHost: string;
  listenPort: number;
  startTime: string;
}

export async function readSettings(): Promise<Settings> {
  if (!existsSync(configuration.settingsFile)) {
    return { ...defaultSettings }
  }

  try {
    const content = await readFile(configuration.settingsFile, 'utf8')
    return JSON.parse(content)
  } catch {
    return { ...defaultSettings }
  }
}

export async function readHubSettings(): Promise<HubListenSettings> {
  if (!existsSync(configuration.hubSettingsFile)) {
    return {}
  }

  try {
    const content = await readFile(configuration.hubSettingsFile, 'utf8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

/**
 * 设置文件锁内的读-改-写（cli 与 hub 对称的锁协议：.lock wx 独占创建 + 重试 + stale 清理）。
 * cli 文件与 hub 文件各有自己的锁文件，跨进程互斥。
 */
async function withSettingsLock<S extends object>(
  settingsFile: string,
  read: () => Promise<S>,
  updater: (current: S) => S | Promise<S>
): Promise<S> {
  // Timing constants
  const LOCK_RETRY_INTERVAL_MS = 100;  // How long to wait between lock attempts
  const MAX_LOCK_ATTEMPTS = 50;        // Maximum number of attempts (5 seconds total)
  const STALE_LOCK_TIMEOUT_MS = 10000; // Consider lock stale after 10 seconds

  if (!existsSync(configuration.mobiHomeDir)) {
    await mkdir(configuration.mobiHomeDir, { recursive: true });
  }

  const lockFile = settingsFile + '.lock';
  const tmpFile = settingsFile + '.tmp';
  let fileHandle;
  let attempts = 0;

  // Acquire exclusive lock with retries
  while (attempts < MAX_LOCK_ATTEMPTS) {
    try {
      // 'wx' = create exclusively, fail if exists (cross-platform compatible)
      fileHandle = await open(lockFile, 'wx');
      break;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && (err as { code?: unknown }).code === 'EEXIST') {
        // Lock file exists, wait and retry
        attempts++;
        await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_INTERVAL_MS));

        // Check for stale lock
        try {
          const stats = await stat(lockFile);
          if (Date.now() - stats.mtimeMs > STALE_LOCK_TIMEOUT_MS) {
            await unlink(lockFile).catch(() => { /* 错误可忽略：锁文件可能已被其他进程清理 */ });
          }
        } catch { /* 错误可忽略：stale lock 检查失败不阻塞获取锁 */ }
      } else {
        throw err;
      }
    }
  }

  if (!fileHandle) {
    throw new Error(`Failed to acquire settings lock after ${MAX_LOCK_ATTEMPTS * LOCK_RETRY_INTERVAL_MS / 1000} seconds`);
  }

  try {
    // Read current settings with defaults
    const current = await read();

    // Apply update
    const updated = await updater(current);

    // Write atomically using rename
    await writeFile(tmpFile, JSON.stringify(updated, null, 2));
    await rename(tmpFile, settingsFile); // Atomic on POSIX

    return updated;
  } finally {
    // Release lock
    await fileHandle.close();
    await unlink(lockFile).catch(() => { }); // Remove lock file
  }
}

/**
 * Atomically update cli settings with multi-process safety via file locking
 * @param updater Function that takes current settings and returns updated settings
 * @returns The updated settings
 */
export async function updateSettings(
  updater: (current: Settings) => Settings | Promise<Settings>
): Promise<Settings> {
  return withSettingsLock(configuration.settingsFile, readSettings, updater)
}

/**
 * 受限写本机 hub 设置文件的 listen* 字段（co-located 部署时 hub 与 cli 同 MOBI_HOME）。
 * 锁内读-改-写且只合并 listen*：hub 文件其余字段（token/vapidKeys 等）归 hub 所有，
 * 不得被 cli 侧写覆盖。远程部署时 hub 文件不在本机，此写只影响本机残留文件——
 * 远程场景的 hub 监听配置应直接编辑 hub 机器上的 settings.hub.json。
 */
export async function updateHubSettings(
  updater: (current: HubListenSettings) => HubListenSettings | Promise<HubListenSettings>
): Promise<HubListenSettings> {
  return withSettingsLock(configuration.hubSettingsFile, readHubSettings, async (current) => {
    const next = await updater(current)
    // listen* 允许更新，其余字段（hub 所有：token/vapidKeys 等）原样保留
    return { ...current, listenHost: next.listenHost, listenPort: next.listenPort }
  })
}

//
// Authentication
//

export async function writeCredentialsDataKey(credentials: { publicKey: Uint8Array, machineKey: Uint8Array, token: string }): Promise<void> {
  if (!existsSync(configuration.mobiHomeDir)) {
    await mkdir(configuration.mobiHomeDir, { recursive: true })
  }
  await writeFile(configuration.privateKeyFile, JSON.stringify({
    encryption: { publicKey: Buffer.from(credentials.publicKey).toString('base64'), machineKey: Buffer.from(credentials.machineKey).toString('base64') },
    token: credentials.token
  }, null, 2));
}

export async function clearCredentials(): Promise<void> {
  if (existsSync(configuration.privateKeyFile)) {
    await unlink(configuration.privateKeyFile);
  }
}

export async function clearMachineId(): Promise<void> {
  await updateSettings(settings => ({
    ...settings,
    machineId: undefined
  }));
}

/**
 * Read runner state from local file
 */
export async function readRunnerState(): Promise<RunnerLocallyPersistedState | null> {
  try {
    if (!existsSync(configuration.runnerStateFile)) {
      return null;
    }
    const content = await readFile(configuration.runnerStateFile, 'utf-8');
    return JSON.parse(content) as RunnerLocallyPersistedState;
  } catch (error) {
    // State corrupted somehow :(
    console.error(`[PERSISTENCE] Runner state file corrupted: ${configuration.runnerStateFile}`, error);
    return null;
  }
}

/**
 * Write runner state to local file (synchronously for atomic operation)
 */
export function writeRunnerState(state: RunnerLocallyPersistedState): void {
  writeFileSync(configuration.runnerStateFile, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Clean up runner state file and lock file
 */
export async function clearRunnerState(): Promise<void> {
  if (existsSync(configuration.runnerStateFile)) {
    await unlink(configuration.runnerStateFile);
  }
  // Also clean up lock file if it exists (for stale cleanup)
  if (existsSync(configuration.runnerLockFile)) {
    try {
      await unlink(configuration.runnerLockFile);
    } catch {
      // Lock file might be held by running runner, ignore error
    }
  }
}

/**
 * Acquire an exclusive lock file for the runner.
 * The lock file proves the runner is running and prevents multiple instances.
 * Returns the file handle to hold for the runner's lifetime, or null if locked.
 */
export async function acquireRunnerLock(
  maxAttempts: number = 5,
  delayIncrementMs: number = 200
): Promise<FileHandle | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // 'wx' ensures we only create if it doesn't exist (atomic lock acquisition)
      const fileHandle = await open(configuration.runnerLockFile, 'wx');
      // Write PID to lock file for debugging
      await fileHandle.writeFile(String(process.pid));
      return fileHandle;
    } catch (error: unknown) {
      if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'EEXIST') {
        // Lock file exists, check if process is still running
        try {
          const lockPid = readFileSync(configuration.runnerLockFile, 'utf-8').trim();
          if (lockPid && !isNaN(Number(lockPid))) {
            if (!isProcessAlive(Number(lockPid))) {
              // Process doesn't exist, remove stale lock
              unlinkSync(configuration.runnerLockFile);
              continue; // Retry acquisition
            }
          }
        } catch {
          // Can't read lock file, might be corrupted
        }
      }

      if (attempt === maxAttempts) {
        return null;
      }
      const delayMs = attempt * delayIncrementMs;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return null;
}

/**
 * Release runner lock by closing handle and deleting lock file
 */
export async function releaseRunnerLock(lockHandle: FileHandle): Promise<void> {
  try {
    await lockHandle.close();
  } catch { /* 错误可忽略：handle 可能已关闭 */ }

  try {
    if (existsSync(configuration.runnerLockFile)) {
      unlinkSync(configuration.runnerLockFile);
    }
  } catch { /* 错误可忽略：锁文件可能已被其他进程删除 */ }
}

//
// Hub 状态持久化
//

/**
 * 读取 Hub 状态文件
 */
export async function readHubState(): Promise<HubLocallyPersistedState | null> {
  try {
    if (!existsSync(configuration.hubStateFile)) {
      return null;
    }
    const content = await readFile(configuration.hubStateFile, 'utf-8');
    return JSON.parse(content) as HubLocallyPersistedState;
  } catch (error) {
    console.error(`[PERSISTENCE] Hub state file corrupted: ${configuration.hubStateFile}`, error);
    return null;
  }
}

/**
 * 写入 Hub 状态文件（同步写入保证原子性）
 */
export function writeHubState(state: HubLocallyPersistedState): void {
  writeFileSync(configuration.hubStateFile, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * 清理 Hub 状态文件
 */
export async function clearHubState(): Promise<void> {
  if (existsSync(configuration.hubStateFile)) {
    await unlink(configuration.hubStateFile);
  }
}
