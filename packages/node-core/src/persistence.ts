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

/** daemon 设置文件受限写形状：cli 只允许写 listen*（daemon 监听配置），其余字段归 daemon 所有 */
export interface DaemonSettings {
  listenHost?: string
  listenPort?: number
}

const defaultSettings: Settings = {}

/**
 * daemon 本地状态（唯一进程状态文件）：
 * daemonEntry 启动就绪时写入、优雅退出时清理。读取方：loopbackControlPost
 * （controlServer 探活）、doctor、upgrader/processRestarter、supervisor 孤儿清理、
 * e2e 脚本。
 *
 * 501/502 起字段随 hub/runner 更名 daemon 读旧写新：写恒用 httpPort/controlPort，
 * 读取方对存量旧字段 hubPort/runnerHttpPort 做兜底（ ?? 过渡，见各读取点）。
 */
export interface DaemonLocallyPersistedState {
  pid: number;
  /** 主端口（Web + /terminal）；旧名 hubPort（读兜底） */
  httpPort: number;
  /** 宿主通道端口（ticket-21：/cli socket + /cli/* HTTP 的 loopback listener） */
  hostPort: number;
  /** 同进程 executor 的 controlServer 端口（进程管理通道）；旧名 runnerHttpPort（读兜底） */
  controlPort: number;
  startTime: string;
}

/** 502 前的旧字段名（读兜底用） */
export interface LegacyDaemonStateFields {
  hubPort?: number
  runnerHttpPort?: number
}

/**
 * 读取 daemon 状态文件；缺失/损坏返回 null（损坏仅记 stderr 不抛）
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
 * 写入 daemon 状态文件（同步写保证原子性）
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

/**
 * settings.daemon.json 文件名定稿（remove-machine 501）：旧名 settings.hub.json → 新名
 * settings.daemon.json 的读旧写新迁移。新文件已存在（daemon 侧已迁移）→ 幂等跳过；
 * 旧文件不存在 → 无事发生。rename 失败（如并发下旧文件已被 daemon 侧迁走）静默忽略。
 */
async function migrateHubSettingsFilename(): Promise<void> {
  const legacyFile = join(configuration.mobiHomeDir, 'settings.hub.json')
  const newFile = configuration.daemonSettingsFile
  if (!existsSync(legacyFile) || existsSync(newFile)) {
    return
  }
  try {
    await rename(legacyFile, newFile)
    console.log(`[PERSISTENCE] Migrated ${legacyFile} -> ${newFile}`)
  } catch {
    // 并发迁移竞争：daemon 侧可能已抢先 rename，忽略
  }
}

export async function readDaemonSettings(): Promise<DaemonSettings> {
  // 读旧写新：新文件已定稿读新文件；仅存量旧文件时读旧（co-located 升级窗口兼容）
  if (!existsSync(configuration.daemonSettingsFile)) {
    const legacyFile = join(configuration.mobiHomeDir, 'settings.hub.json')
    if (!existsSync(legacyFile)) {
      return {}
    }
    // 解析失败抛错（fail-fast，与 daemon 侧 readSettingsRaw 对称）
    const content = await readFile(legacyFile, 'utf8')
    return JSON.parse(content)
  }

  // 解析失败抛错（fail-fast，与 hub 侧 readSettingsRaw 对称）：
  // updateDaemonSettings 锁内经此读取，吞错返回 {} 会把 daemon 文件覆盖成只剩 listen*，
  // webApiToken/vapidKeys 等字段全丢
  const content = await readFile(configuration.daemonSettingsFile, 'utf8')
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
 * 受限写本机 daemon 设置文件的 listen* 字段（co-located 部署时 daemon 与 cli 同 MOBI_HOME）。
 * 写前先做文件名迁移（旧 settings.hub.json → settings.daemon.json，读旧写新）。
 * 锁内读-改-写且只合并 listen*：daemon 文件其余字段（token/vapidKeys 等）归 daemon 所有，
 * 不得被 cli 侧写覆盖。远程部署时 daemon 文件不在本机，此写只影响本机残留文件——
 * 远程场景的 daemon 监听配置应直接编辑 daemon 机器上的 settings.daemon.json。
 */
export async function updateDaemonSettings(
  updater: (current: DaemonSettings) => DaemonSettings | Promise<DaemonSettings>
): Promise<DaemonSettings> {
  await migrateHubSettingsFilename()
  return withSettingsLock(configuration.daemonSettingsFile, readDaemonSettings, async (current) => {
    const next = await updater(current)
    // listen* 允许更新，其余字段（daemon 所有：token/vapidKeys 等）原样保留
    return { ...current, listenHost: next.listenHost, listenPort: next.listenPort }
  })
}

/** 旧单文件中 cli 专属字段（与 daemon 侧 migrateSettings 的 CLI_ONLY_FIELDS + cliApiToken 对应） */
const LEGACY_CLI_FIELDS = [
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
  // remove-machine 503：machineId 随 machine 概念移除清除——cli 配置残留字段一次性删除
  //（幂等：无残留不写盘；任何命令启动都会经过这里，旧文件/旧写法的 machineId 在此消失）
  const current = await readSettings() as Settings & { machineId?: unknown }
  if (current.machineId !== undefined) {
    await updateSettings(settings => {
      const next = { ...settings } as Settings & { machineId?: unknown }
      delete next.machineId
      return next as Settings
    })
    console.log('[PERSISTENCE] Removed legacy machineId from settings.cli.json')
  }

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
  const existing = await readSettings()
  const hasMissing = Object.keys(cliSplit).some(
    key => (existing as unknown as Record<string, unknown>)[key] === undefined
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

/**
 * Acquire an exclusive lock file for the daemon.
 * The lock file proves the daemon is running and prevents multiple instances.
 * Returns the file handle to hold for the daemon's lifetime, or null if locked.
 *
 * 502 锁文件定稿（R4）：runner.state.json.lock → daemon.lock 读旧防双实例——
 * 旧名锁存在且 pid 活 → 视为占用（拒启）；pid 死/损坏 → 清理旧名锁后正常获取新锁。
 */
export async function acquireDaemonLock(
  maxAttempts: number = 5,
  delayIncrementMs: number = 200
): Promise<FileHandle | null> {
  // 升级窗口防双实例：旧名锁仍被活进程持有 → 拒启（R4）
  const legacyLockFile = join(configuration.mobiHomeDir, 'runner.state.json.lock')
  if (existsSync(legacyLockFile)) {
    let legacyAlive = false
    try {
      const legacyPid = Number(readFileSync(legacyLockFile, 'utf-8').trim());
      legacyAlive = Number.isFinite(legacyPid) && legacyPid > 0 && isProcessAlive(legacyPid);
    } catch {
      // 旧锁损坏内容按死锁处理（下方删除）
    }
    if (legacyAlive) {
      return null;
    }
    try {
      unlinkSync(legacyLockFile);
    } catch {
      // 并发竞争下可能已被其他进程删除，继续尝试新锁
    }
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // 'wx' ensures we only create if it doesn't exist (atomic lock acquisition)
      const fileHandle = await open(configuration.daemonLockFile, 'wx');
      // Write PID to lock file for debugging
      await fileHandle.writeFile(String(process.pid));
      return fileHandle;
    } catch (error: unknown) {
      if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'EEXIST') {
        // Lock file exists, check if process is still running.
        // 锁内容不是「存活进程的 PID」（死 PID / 空文件 / 损坏内容）一律视为陈旧锁删除——
        // 否则一个 0 字节残留锁会让所有后续 daemon 拿锁失败后静默退出（E2E 实踩）
        let staleLock: boolean
        try {
          const lockPid = Number(readFileSync(configuration.daemonLockFile, 'utf-8').trim());
          staleLock = !Number.isFinite(lockPid) || lockPid <= 0 || !isProcessAlive(lockPid);
        } catch {
          // Can't read lock file, might be corrupted
          staleLock = true;
        }
        if (staleLock) {
          try {
            unlinkSync(configuration.daemonLockFile);
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
 * Release daemon lock by closing handle and deleting lock file
 */
export async function releaseDaemonLock(lockHandle: FileHandle): Promise<void> {
  try {
    await lockHandle.close();
  } catch { /* 错误可忽略：handle 可能已关闭 */ }

  try {
    if (existsSync(configuration.daemonLockFile)) {
      unlinkSync(configuration.daemonLockFile);
    }
  } catch { /* 错误可忽略：锁文件可能已被其他进程删除 */ }
}

