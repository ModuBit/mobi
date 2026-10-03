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
import { readFile, writeFile, mkdir, open, unlink, rename, stat, chmod } from 'node:fs/promises'
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { configuration } from './configuration'
import { isProcessAlive } from './utils/process';
// Settings 定义已抽 settingsTypes.ts（断 configuration↔persistence 循环，ticket-11）；
// 此处 re-export 保调用方（import type { Settings } from persistence）零改动
export type { Settings } from './settingsTypes'
import type { Settings } from './settingsTypes'

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

/**
 * daemon 本地状态（ticket-22 起 hub/runner state 文件停写后的唯一进程状态）：
 * daemonEntry 启动就绪时写入、优雅退出时清理。读取方：loopbackRunnerPost
 * （controlServer 探活）、doctor、upgrader/processRestarter、supervisor 孤儿清理、
 * e2e 脚本。
 */
export interface DaemonLocallyPersistedState {
  pid: number;
  /** 主端口（Web + /terminal） */
  hubPort: number;
  /** 宿主通道端口（ticket-21：/cli socket + /cli/* HTTP 的 loopback listener） */
  hostPort: number;
  /** runner controlServer 端口（同进程 runner 的进程管理通道） */
  runnerHttpPort: number;
  startTime: string;
}

/**
 * 读取 daemon 状态文件；缺失/损坏返回 null（损坏仅记 stderr 不抛，
 * 与 readRunnerState 的容错语义一致）
 */
export async function readDaemonState(): Promise<DaemonLocallyPersistedState | null> {
  try {
    if (!existsSync(configuration.daemonStateFile)) {
      return null;
    }
    const content = await readFile(configuration.daemonStateFile, 'utf-8');
    return JSON.parse(content) as DaemonLocallyPersistedState;
  } catch (error) {
    console.error(`[PERSISTENCE] Daemon state file corrupted: ${configuration.daemonStateFile}`, error);
    return null;
  }
}

/**
 * 写入 daemon 状态文件（同步写保证原子性，与 writeRunnerState 同语义）
 */
export function writeDaemonState(state: DaemonLocallyPersistedState): void {
  writeFileSync(configuration.daemonStateFile, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * 清理 daemon 状态文件（优雅退出时；清理失败不阻塞退出）
 */
export function clearDaemonState(): void {
  try {
    unlinkSync(configuration.daemonStateFile);
  } catch {
    // 文件可能已不存在
  }
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

  // 解析失败抛错（fail-fast，与 hub 侧 readSettingsRaw 对称）：
  // updateHubSettings 锁内经此读取，吞错返回 {} 会把 hub 文件覆盖成只剩 listen*，
  // webApiToken/vapidKeys 等字段全丢
  const content = await readFile(configuration.hubSettingsFile, 'utf8')
  return JSON.parse(content)
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
    // settings 含 token 凭证（ticket-21 收紧）：落盘前限权，rename 保留 tmp 权限
    await chmod(tmpFile, 0o600);
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

/** 旧单文件中 cli 专属字段（与 hub 侧 migrateSettings 的 CLI_ONLY_FIELDS + cliApiToken 对应） */
const LEGACY_CLI_FIELDS = [
  'machineId',
  'cliApiToken',
  'updateChannel',
  'disconnectTimeoutMs',
  'idleTimeoutMs',
  'timeoutWarningMs',
  'claudeEnv',
  'bashInjectContext',
  'webTools',
] as const

/**
 * cli 侧旧单文件 settings.json 的一次性迁移（hub 与 cli 不同机器部署时，
 * hub 的迁移够不到 cli 机器，cli 自己把存量 cli 字段搬进 settings.cli.json）。
 *
 * 语义：旧文件存在 → 取 cli 专属字段补缺写入 cli 文件（已有值不覆盖，幂等）。
 * 不归档旧文件——归档权归 hub 侧迁移：co-located 时 hub 启动会统一 rename .bak；
 * 远程部署时旧文件留在 cli 机器上无害（新代码不再读它）。
 * 解析失败仅警告跳过不阻断：cli 侧凭证缺失还有交互式 prompt 兜底，
 * fail-fast 会把坏旧文件放大成所有命令不可用。
 */
export async function migrateLegacyCliSettings(): Promise<void> {
  const legacyFile = join(configuration.mobiHomeDir, 'settings.json')
  if (!existsSync(legacyFile)) {
    return
  }

  let legacy: Record<string, unknown>
  try {
    legacy = JSON.parse(await readFile(legacyFile, 'utf8')) as Record<string, unknown>
  } catch (error) {
    console.error(`[PERSISTENCE] Legacy settings file cannot be parsed, skipping cli migration: ${legacyFile}`, error)
    return
  }

  const cliSplit: Record<string, unknown> = {}
  for (const key of LEGACY_CLI_FIELDS) {
    if (key in legacy) {
      cliSplit[key] = legacy[key]
    }
  }
  if (Object.keys(cliSplit).length === 0) {
    return
  }

  // 已无缺失字段则不写盘（迁移幂等，避免每次启动无谓 I/O）
  const current = await readSettings()
  const hasMissing = Object.keys(cliSplit).some(
    key => (current as unknown as Record<string, unknown>)[key] === undefined
  )
  if (!hasMissing) {
    return
  }

  await updateSettings(currentSettings => {
    const merged = { ...currentSettings } as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(cliSplit)) {
      if (merged[key] === undefined) {
        merged[key] = value
      }
    }
    return merged as unknown as Settings
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
        // Lock file exists, check if process is still running.
        // 锁内容不是「存活进程的 PID」（死 PID / 空文件 / 损坏内容）一律视为陈旧锁删除——
        // 否则一个 0 字节残留锁会让所有后续 runner 拿锁失败后静默退出（E2E 实踩）
        let staleLock: boolean
        try {
          const lockPid = Number(readFileSync(configuration.runnerLockFile, 'utf-8').trim());
          staleLock = !Number.isFinite(lockPid) || lockPid <= 0 || !isProcessAlive(lockPid);
        } catch {
          // Can't read lock file, might be corrupted
          staleLock = true;
        }
        if (staleLock) {
          try {
            unlinkSync(configuration.runnerLockFile);
          } catch {
            // 并发竞争下可能已被其他进程删除，下一轮重试兜底
          }
          continue; // Retry acquisition
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
// 旧形态 Hub 状态文件（ticket-22 停写；readHubState/readRunnerState 仅供
// supervisor 孤儿清理做升级过渡期兜底，存量环境全量切换后删除）
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

