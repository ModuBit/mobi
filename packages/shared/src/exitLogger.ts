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
 * 进程退出日志 —— 集中式记录 hub/runner/cli 的正常/异常/被外部杀死退出。
 *
 * 与 profile.ts 同属跨包基础设施（hub / cli 共用），故置于 shared 包。
 *
 * 设计见 docs/superpowers/specs/2026-07-20-exit-logging-design.md
 *
 * 关键约束：
 * - SIGKILL / OOM killer / 段错误时 JS 运行时来不及执行，本模块写不出任何记录，
 *   需由进程启动时的「检测上次 pid 已死」兜底（recordExternalKill）补记。
 * - 本模块 side-effect-free：installExitLogger 显式调用后才创建目录 / 安装 handler，
 *   符合 shared package.json 的 sideEffects:false。
 */

import {
  appendFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync,
  renameSync,
  unlinkSync,
  readFileSync
} from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'

export type ProcessType = 'hub' | 'runner' | 'cli'

export type ExitReason =
  | 'normal'
  | 'error-exit'
  | 'signal-int'
  | 'signal-term'
  | 'crash-uncaught'
  | 'crash-unhandled'
  | 'killed-externally'

/** ring buffer 读取接口，由调用方（现有 Logger）实现并注入 */
export interface RingBufferReader {
  snapshot(): string[]
}

export interface RecordExitInput {
  reason: ExitReason
  exitCode?: number
  signal?: string | null
  errorMessage?: string
  stack?: string
}

/** exits.log 单行结构 */
export interface ExitRecord {
  timestamp: string
  processType: ProcessType
  pid: number
  exitCode: number | null
  signal: string | null
  reason: ExitReason
  errorMessage: string | null
  stackHead: string | null
  uptimeMs: number | null
  peakMemoryMb: number | null
  dumpFile: string | null
  /** 父进程 pid —— 推断 SIGTERM 来源（进程组/会话）的关键线索 */
  ppid: number | null
  /** 父进程命令行（截断），便于人工辨识启动者 */
  parentCommand: string | null
}

const STACK_HEAD_LIMIT = 2048
const RECENT_LOG_LIMIT = 200
const EXIT_LOG_FILENAME = 'exits.log'
const DUMPS_DIRNAME = 'dumps'
const PARENT_COMMAND_LIMIT = 512

/** 仅保留非敏感 env，严禁记录任何 token / secret / 密钥 */
const SAFE_ENV_KEYS = ['MOBI_HOME', 'MOBI_PROFILE', 'MOBI_API_URL', 'NODE_ENV', 'DEV'] as const

export interface InstallOptions {
  logsDir: string
  ringBuffer?: RingBufferReader
  /** exits.log 单文件字节阈值，超过则滚动，默认 5MB */
  maxRollSize?: number
  /** 滚动保留的文件数（含 .1 ~ .N），默认 5 */
  maxRollCount?: number
}

export interface ExitLogger {
  /** 记录一次退出（幂等：同一实例只生效一次） */
  recordExit(input: RecordExitInput): void
  /** 启动检测兜底：上次运行中但 pid 已死，补记 killed-externally（不受幂等约束） */
  recordExternalKill(prevPid: number, prevStartTime?: string): void
}

/**
 * 从 MOBI_HOME（或默认 ~/.mobi）解析 logs 目录。
 * 供调用方在 configuration 单例就绪前独立解析用（exitLogger 需最早挂载）。
 */
export function resolveMobiLogsDir(): string {
  return join(resolveMobiHome(), 'logs')
}

/**
 * 从 MOBI_HOME（或默认 ~/.mobi）解析根目录。供定位 hub.state.json / runner.state.json。
 */
export function resolveMobiHome(): string {
  return process.env.MOBI_HOME
    ? process.env.MOBI_HOME.replace(/^~/, homedir())
    : join(homedir(), '.mobi')
}

/**
 * 检测 pid 是否存活（启动检测兜底用，零依赖 process.kill 探测）。
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * 读取 exits.log 全部记录（按时间正序），供 doctor exits 命令使用。
 * 跳过空行与解析失败的行。
 */
export function readExitRecords(logsDir: string): ExitRecord[] {
  const file = join(logsDir, EXIT_LOG_FILENAME)
  if (!existsSync(file)) return []
  let content: string
  try {
    content = readFileSync(file, 'utf-8')
  } catch {
    return []
  }
  const records: ExitRecord[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as Partial<ExitRecord>
      // 前向兼容：旧记录无 ppid/parentCommand 字段，补 null
      records.push({
        timestamp: parsed.timestamp ?? '',
        processType: parsed.processType ?? 'cli',
        pid: parsed.pid ?? 0,
        exitCode: parsed.exitCode ?? null,
        signal: parsed.signal ?? null,
        reason: parsed.reason ?? 'normal',
        errorMessage: parsed.errorMessage ?? null,
        stackHead: parsed.stackHead ?? null,
        uptimeMs: parsed.uptimeMs ?? null,
        peakMemoryMb: parsed.peakMemoryMb ?? null,
        dumpFile: parsed.dumpFile ?? null,
        ppid: parsed.ppid ?? null,
        parentCommand: parsed.parentCommand ?? null,
      })
    } catch {
      // 跳过损坏行
    }
  }
  return records
}

export function installExitLogger(
  processType: ProcessType,
  options: InstallOptions
): ExitLogger {
  const logsDir = options.logsDir
  const maxRollSize = options.maxRollSize ?? 5 * 1024 * 1024
  const maxRollCount = options.maxRollCount ?? 5
  const startedAt = Date.now()
  let alreadyRecorded = false
  let peakMemoryMb = computeMemoryMb()

  // 启动时同步采集父进程谱系 —— SIGTERM 来源（进程组/会话批量终止）的唯一可观测线索
  const parentPid = process.ppid > 0 ? process.ppid : null
  const parentCommand = parentPid != null ? readParentCommand(parentPid) : null

  // 定期采样峰值内存（用于 crash 时还原），unref 避免阻止进程退出
  const memSampler = setInterval(() => {
    const current = computeMemoryMb()
    if (current > peakMemoryMb) peakMemoryMb = current
  }, 5_000)
  memSampler.unref?.()

  ensureDir(logsDir)
  ensureDir(join(logsDir, DUMPS_DIRNAME))

  function recordExit(input: RecordExitInput): void {
    if (alreadyRecorded) return
    alreadyRecorded = true

    let dumpFile: string | null = null
    if (input.reason === 'crash-uncaught' || input.reason === 'crash-unhandled') {
      dumpFile = writeDump(processType, logsDir, input, options.ringBuffer, peakMemoryMb, startedAt, parentPid, parentCommand)
      writeHeapSnapshotBestEffort(processType, logsDir)
    }

    const record: ExitRecord = {
      timestamp: new Date().toISOString(),
      processType,
      pid: process.pid,
      exitCode: input.exitCode ?? null,
      signal: input.signal ?? null,
      reason: input.reason,
      errorMessage: input.errorMessage ?? null,
      stackHead: input.stack ? input.stack.slice(0, STACK_HEAD_LIMIT) : null,
      uptimeMs: Date.now() - startedAt,
      peakMemoryMb,
      dumpFile,
      ppid: parentPid,
      parentCommand
    }

    appendAndRoll(logsDir, JSON.stringify(record) + '\n', maxRollSize, maxRollCount)
  }

  function recordExternalKill(prevPid: number, prevStartTime?: string): void {
    const record: ExitRecord = {
      timestamp: new Date().toISOString(),
      processType,
      pid: prevPid,
      exitCode: null,
      signal: null,
      reason: 'killed-externally',
      errorMessage: prevStartTime
        ? `上次实例 startTime=${prevStartTime} 的 pid=${prevPid} 启动时检测已不存在（疑似被 SIGKILL/OOM/段错误终止）`
        : `pid=${prevPid} 启动时检测已不存在（疑似被外部终止）`,
      stackHead: null,
      uptimeMs: null,
      peakMemoryMb: null,
      dumpFile: null,
      ppid: null,
      parentCommand: null
    }
    // 兜底记录的是「上次实例」，不受本实例 alreadyRecorded 约束
    appendAndRoll(logsDir, JSON.stringify(record) + '\n', maxRollSize, maxRollCount)
  }

  return { recordExit, recordExternalKill }
}

/**
 * 在进程上挂载退出/崩溃/信号 handler，统一分发到 exitLogger。
 *
 * 注意：runner 已有自己的优雅退出流程（requestShutdown），runner 侧应自行挂载
 * 并在 handler 内既驱动 requestShutdown 又调 recordExit，而不是用这个默认实现。
 */
export interface InstallHandlersOptions {
  /** 信号记录后是否立即 process.exit。默认 false。
   * cli 主进程传 true（无自定义退出 handler，否则 Ctrl+C/SIGTERM 无法终止进程）；
   * hub 保留 false（依赖自有 shutdown handler 优雅退出）。
   * uncaughtException/unhandledRejection 不受此选项影响——崩溃始终 exit(1)。 */
  exitOnSignal?: boolean
  /** process.on('exit') 内同步调用。
   * 信号终止时 SIGTERM handler 偶发不触发（Bun 在特定时机只走默认退出），
   * 此时 exit handler 是唯一可靠的同步清理时机 —— 用它清理 state 文件等关键副作用。 */
  onExitSync?: () => void
}

export function installExitHandlers(
  processType: ProcessType,
  logger: ExitLogger,
  onSignal?: (signal: NodeJS.Signals) => void,
  options?: InstallHandlersOptions
): void {
  const exitOnSignal = options?.exitOnSignal ?? false

  process.on('uncaughtException', (error: Error) => {
    logger.recordExit({
      reason: 'crash-uncaught',
      errorMessage: error.message,
      stack: error.stack
    })
    try {
      process.stderr.write(`[mobi/${processType}] uncaughtException: ${error.message}\n`)
    } catch {
      // 忽略
    }
    // 注册 uncaughtException listener 即抑制 Node 默认崩溃，必须显式 exit，
    // 否则进程会带着损坏状态继续运行
    process.exit(1)
  })

  process.on('unhandledRejection', (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason))
    logger.recordExit({
      reason: 'crash-unhandled',
      errorMessage: error.message,
      stack: error.stack
    })
    try {
      process.stderr.write(`[mobi/${processType}] unhandledRejection: ${error.message}\n`)
    } catch {
      // 忽略
    }
    process.exit(1)
  })

  const signalHandler = (signal: NodeJS.Signals) => {
    logger.recordExit({
      reason: signal === 'SIGINT' ? 'signal-int' : 'signal-term',
      signal
    })
    if (exitOnSignal) {
      // 128 + 信号号是 POSIX 惯例（SIGINT=130, SIGTERM=143）
      process.exit(signalExitCode(signal))
      return
    }
    onSignal?.(signal)
  }

  process.on('SIGINT', signalHandler)
  process.on('SIGTERM', signalHandler)
  if (process.platform === 'win32') {
    process.on('SIGBREAK', signalHandler)
  }

  process.on('exit', (code: number) => {
    // exit handler 内只能同步写——recordExit 已是同步 appendFileSync
    // 信号终止时 SIGTERM handler 偶发不触发，exit handler 是兜底的同步清理时机
    try {
      options?.onExitSync?.()
    } catch {
      // 清理失败不影响退出记录
    }
    logger.recordExit({
      reason: code === 0 ? 'normal' : 'error-exit',
      exitCode: code
    })
  })
}

/** 常见信号 → POSIX 惯例退出码（128 + 信号号） */
function signalExitCode(signal: NodeJS.Signals): number {
  if (signal === 'SIGINT') return 130
  if (signal === 'SIGTERM') return 143
  return 1
}

/**
 * 追加一行到 exits.log；若追加后会超阈值，先滚动（rename exits.log → .1 → .2 …）再追加，
 * 保证 exits.log 始终存在且含最新记录，旧内容顺次下移。
 */
function appendAndRoll(logsDir: string, line: string, maxRollSize: number, maxRollCount: number): void {
  const file = join(logsDir, EXIT_LOG_FILENAME)
  try {
    if (existsSync(file)) {
      const projected = statSync(file).size + Buffer.byteLength(line, 'utf-8')
      if (projected > maxRollSize) {
        rollLogs(logsDir, maxRollCount)
      }
    }
    appendFileSync(file, line, 'utf-8')
  } catch {
    // 写失败不致命（磁盘满等），避免记录本身导致二次崩溃
  }
}

/**
 * 滚动：exits.log → exits.log.1 → exits.log.2 → ...，删除超过 maxRollCount 的。
 */
function rollLogs(logsDir: string, maxRollCount: number): void {
  // 从最旧开始处理：.maxRollCount-1 → .maxRollCount（超出则删），依次下移
  for (let i = maxRollCount; i >= 1; i--) {
    const target = join(logsDir, `${EXIT_LOG_FILENAME}.${i}`)
    const source = i === 1
      ? join(logsDir, EXIT_LOG_FILENAME)
      : join(logsDir, `${EXIT_LOG_FILENAME}.${i - 1}`)
    if (!existsSync(source)) continue
    if (i >= maxRollCount) {
      // 最高位：target 若存在先删，再把 source 重命名过来（i === maxRollCount 时）
      try {
        if (existsSync(target)) unlinkSync(target)
      } catch {
        // 忽略
      }
      if (i === maxRollCount) {
        try {
          renameSync(source, target)
        } catch {
          // 忽略
        }
      }
      continue
    }
    try {
      renameSync(source, target)
    } catch {
      // 忽略
    }
  }
}

function writeDump(
  processType: ProcessType,
  logsDir: string,
  input: RecordExitInput,
  ringBuffer: RingBufferReader | undefined,
  peakMemoryMb: number,
  startedAt: number,
  parentPid: number | null,
  parentCommand: string | null
): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const base = `${ts}-${processType}-pid-${process.pid}`
  const dumpRelPath = join(DUMPS_DIRNAME, `${base}.json`)
  const dumpAbsPath = join(logsDir, dumpRelPath)

  const payload = {
    timestamp: new Date().toISOString(),
    processType,
    pid: process.pid,
    ppid: parentPid,
    parentCommand,
    reason: input.reason,
    exitCode: input.exitCode ?? null,
    signal: input.signal ?? null,
    errorMessage: input.errorMessage ?? null,
    fullStack: input.stack ?? null,
    uptimeMs: Date.now() - startedAt,
    peakMemoryMb,
    argv: process.argv,
    runtime: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      bunVersion: (globalThis as unknown as { Bun?: { version?: string } }).Bun?.version ?? null
    },
    env: pickSafeEnv(),
    recentLogs: ringBuffer ? ringBuffer.snapshot().slice(-RECENT_LOG_LIMIT) : []
  }

  try {
    appendFileSync(dumpAbsPath, JSON.stringify(payload, null, 2), 'utf-8')
  } catch {
    // best-effort
  }
  return dumpRelPath
}

function writeHeapSnapshotBestEffort(processType: ProcessType, logsDir: string): void {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const target = join(logsDir, DUMPS_DIRNAME, `${ts}-${processType}-pid-${process.pid}.heapsnapshot`)
  try {
    // Bun: generateHeapSnapshot 返回 snapshot 对象，序列化后写文件
    const anyBun = (globalThis as unknown as { Bun?: { generateHeapSnapshot?: () => unknown } }).Bun
    if (anyBun?.generateHeapSnapshot) {
      const snapshot = anyBun.generateHeapSnapshot()
      writeFileSync(target, JSON.stringify(snapshot), 'utf-8')
      return
    }
    // Node 兜底：process.dumpHeap 直接写文件（v8）
    const anyProcess = process as unknown as { dumpHeap?: (path: string) => void }
    if (anyProcess.dumpHeap) {
      anyProcess.dumpHeap(target)
    }
    // 若两者都没有（如受限运行时），静默跳过——best-effort
  } catch {
    // best-effort：写失败不影响退出
  }
}

function pickSafeEnv(): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {}
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      result[key] = process.env[key]
    }
  }
  return result
}

function computeMemoryMb(): number {
  const mem = (process as unknown as { memoryUsage?: () => { rss: number } }).memoryUsage?.()
  return mem ? Math.round(mem.rss / 1024 / 1024) : 0
}

/**
 * 读取父进程命令行（跨平台，best-effort）。
 * macOS/Linux 用 ps；Windows 不支持 ps 语义，返回 null。
 * 用于 exits.log 记录父进程谱系，推断 SIGTERM 批量来源。
 */
function readParentCommand(ppid: number): string | null {
  if (process.platform === 'win32') return null
  try {
    const out = execSync(`ps -o command= -p ${ppid}`, {
      encoding: 'utf-8',
      timeout: 2_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return out ? out.slice(0, PARENT_COMMAND_LIMIT) : null
  } catch {
    return null
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}
