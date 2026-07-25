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
 * shared logger 底座：hub / runner / cli 三类进程共用。
 * 走子路径 @mobi/shared/logger（不进 barrel，避免 node:fs/chalk 污染 web bundle，
 * 与 exitLogger/profile 同策略）。
 *
 * 设计：
 * - debug 仅落盘 + ringBuffer（交互模式不打扰 console）
 * - info/warn/error 落盘 + console（前台运行可见；后台 stdio:ignore 时 console 被丢弃但文件已留存）
 * - 行格式：[HH:mm:ss.SSS] [hub] INFO 消息
 * - 文件名：{YYYY-MM-DD-HH-MM-SS-pid-PID}-{processType}.log
 */

import chalk from 'chalk'
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { RingBufferReader } from './exitLogger'

export type LogProcessType = 'hub' | 'runner' | 'cli'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface MobiLogger extends RingBufferReader {
    info(message: string, ...args: unknown[]): void
    warn(message: string, ...args: unknown[]): void
    error(message: string, ...args: unknown[]): void
    debug(message: string, ...args: unknown[]): void
    /** 当前日志文件绝对路径 */
    getLogPath(): string
    /** 返回最近 N 条日志（按时间正序），供 exitLogger crash dump 注入 */
    snapshot(): string[]
}

/** 文件名用时间戳：YYYY-MM-DD-HH-MM-SS-pid-PID（本地时区） */
export function createTimestampForFilename(date: Date = new Date()): string {
    return date.toLocaleString('sv-SE', {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).replace(/[: ]/g, '-').replace(/,/g, '') + '-pid-' + process.pid
}

/** 日志行时间戳：HH:mm:ss.SSS（本地时区） */
export function createTimestampForLogEntry(date: Date = new Date()): string {
    return date.toLocaleTimeString('en-US', {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
    })
}

function sessionLogPath(processType: LogProcessType, logsDir: string): string {
    return join(logsDir, `${createTimestampForFilename()}-${processType}.log`)
}

/**
 * logger 底座基类。
 * cli 的 Logger 继承本类以复用落盘/格式/ringBuffer，并扩展远程上报、debugLargeJson。
 */
export class BaseLogger implements MobiLogger {
    protected readonly ringBuffer: string[] = []
    protected readonly ringBufferCapacity: number
    protected ringWriteIndex = 0

    constructor(
        public readonly processType: LogProcessType,
        public readonly logsDir: string,
        public readonly logFilePath: string,
        options?: { ringBufferCapacity?: number },
    ) {
        this.ringBufferCapacity = Math.max(1, options?.ringBufferCapacity ?? 200)
    }

    info(message: string, ...args: unknown[]): void {
        this.logToConsole('info', message, ...args)
        this.writeLine('info', message, ...args)
    }

    warn(message: string, ...args: unknown[]): void {
        this.logToConsole('warn', message, ...args)
        this.writeLine('warn', message, ...args)
    }

    error(message: string, ...args: unknown[]): void {
        this.logToConsole('error', message, ...args)
        this.writeLine('error', message, ...args)
    }

    debug(message: string, ...args: unknown[]): void {
        // debug 不进 console（交互模式不打扰 claude 会话）
        // 非 DEBUG 模式仅写 ringBuffer（保 crash dump 上下文），不落盘——
        // 避免高频 debug（SDK stream_event / IdleTimer Reset 等）撑爆日志文件
        if (process.env.DEBUG) {
            this.writeLine('debug', message, ...args)
        } else {
            this.pushRingBuffer('debug', message, ...args)
        }
    }

    getLogPath(): string {
        return this.logFilePath
    }

    snapshot(): string[] {
        const len = this.ringBuffer.length
        if (len === 0) return []
        const cap = this.ringBufferCapacity
        // 未满：writeIndex == len，原序返回；满后：writeIndex 指向最旧，从 writeIndex 起顺序读
        const start = len < cap ? 0 : this.ringWriteIndex
        const count = len < cap ? len : cap
        const out: string[] = []
        for (let i = 0; i < count; i++) {
            out.push(this.ringBuffer[(start + i) % cap]!)
        }
        return out
    }

    /**
     * 落盘一行 + 写 ringBuffer。
     * 子类可 override 在 super.writeLine 前追加远程上报（见 cli Logger）。
     */
    protected writeLine(level: LogLevel, message: string, ...args: unknown[]): void {
        const ts = createTimestampForLogEntry()
        const argsPart = args.length > 0 ? ' ' + formatArgs(args) : ''
        const line = `[${ts}] [${this.processType}] ${level.toUpperCase()} ${message}${argsPart}\n`
        try {
            appendFileSync(this.logFilePath, line)
        } catch {
            // best-effort，不阻断主流程
        }
        this.pushRingBuffer(level, message, ...args)
    }

    protected pushRingBuffer(level: LogLevel, message: string, ...args: unknown[]): void {
        let entry: string
        try {
            entry = args.length > 0
                ? `${level} ${message} ${formatArgs(args)}`
                : `${level} ${message}`
        } catch {
            entry = `${level} ${message}`
        }
        if (this.ringBuffer.length < this.ringBufferCapacity) {
            this.ringBuffer.push(entry)
        } else {
            // 满后覆盖最旧位置，O(1) 入队
            this.ringBuffer[this.ringWriteIndex] = entry
        }
        this.ringWriteIndex = (this.ringWriteIndex + 1) % this.ringBufferCapacity
    }

    protected logToConsole(level: LogLevel, message: string, ...args: unknown[]): void {
        const prefix = `[${this.processType}]`
        switch (level) {
            case 'error':
                console.error(chalk.red(prefix), message, ...args)
                break
            case 'warn':
                console.log(chalk.yellow(prefix), message, ...args)
                break
            default:
                console.log(chalk.blue(prefix), message, ...args)
        }
    }
}

function formatArgs(args: unknown[]): string {
    return args.map(a => (typeof a === 'string' ? a : safeStringify(a))).join(' ')
}

function safeStringify(a: unknown): string {
    try {
        return JSON.stringify(a)
    } catch {
        return String(a)
    }
}

export interface CreateLoggerOptions {
    processType: LogProcessType
    logsDir: string
    logFilePath?: string
    ringBufferCapacity?: number
    /** 启动时清理旧日志，默认 false（由长生命周期进程 main 显式调用，避免短命令/测试触发副作用） */
    cleanup?: boolean
}

/**
 * 创建一个 logger 实例，并确保 logsDir 存在。
 * cleanup 默认不执行（见上）；长生命周期进程应在 main 里显式调 cleanupOldLogs。
 * 每次进程启动产生一个新文件（{ts}-{processType}.log）。
 */
export function createLogger(opts: CreateLoggerOptions): MobiLogger {
    const logFilePath = opts.logFilePath ?? sessionLogPath(opts.processType, opts.logsDir)
    // 自保目录：不依赖外部（exitLogger ensureDir / cli configuration mkdirSync）先行创建
    ensureDir(opts.logsDir)
    const instance = new BaseLogger(opts.processType, opts.logsDir, logFilePath, {
        ringBufferCapacity: opts.ringBufferCapacity,
    })
    if (opts.cleanup) {
        try {
            cleanupOldLogs(opts.logsDir)
        } catch {
            // best-effort，清理失败不影响日志写入
        }
    }
    return instance
}

/** 确保 logsDir 存在（best-effort，失败不阻断日志写入） */
function ensureDir(dir: string): void {
    try {
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true })
        }
    } catch {
        // best-effort
    }
}

/** 查找指定 processType 的最新日志文件（按 mtime 降序），无则 null */
export function findLatestLog(logsDir: string, processType: LogProcessType): string | null {
    if (!existsSync(logsDir)) return null
    const suffix = `-${processType}.log`
    let best: { path: string; mtime: number } | null = null
    for (const file of readdirSync(logsDir)) {
        if (!file.endsWith(suffix)) continue
        const fullPath = join(logsDir, file)
        const mtime = statSync(fullPath).mtimeMs
        if (!best || mtime > best.mtime) best = { path: fullPath, mtime }
    }
    return best?.path ?? null
}

/**
 * 清理 {ts}-*.log：超 maxAgeDays 天 或 单类超 keepPerType 个。
 * 不动 exits.log 与 dumps/（exitLogger 自带滚动）。
 */
export function cleanupOldLogs(
    logsDir: string,
    opts: { maxAgeDays?: number; keepPerType?: number } = {},
): { removed: number } {
    if (!existsSync(logsDir)) return { removed: 0 }
    const maxAgeMs = (opts.maxAgeDays ?? 7) * 24 * 60 * 60 * 1000
    const keepPerType = opts.keepPerType ?? 50
    const now = Date.now()
    let removed = 0

    const byType: Record<LogProcessType, { path: string; mtime: number }[]> = {
        hub: [],
        runner: [],
        cli: [],
    }
    for (const file of readdirSync(logsDir)) {
        if (!file.endsWith('.log') || file === 'exits.log') continue
        const fullPath = join(logsDir, file)
        const st = statSync(fullPath)
        // 超龄直接删
        if (now - st.mtimeMs > maxAgeMs) {
            rmSync(fullPath, { force: true })
            removed++
            continue
        }
        const type = (['hub', 'runner', 'cli'] as LogProcessType[]).find(t => file.endsWith(`-${t}.log`))
        if (type) byType[type].push({ path: fullPath, mtime: st.mtimeMs })
    }
    // 单类超出保留数，删最旧的
    for (const type of Object.keys(byType) as LogProcessType[]) {
        const arr = byType[type].sort((a, b) => b.mtime - a.mtime)
        for (const item of arr.slice(keepPerType)) {
            rmSync(item.path, { force: true })
            removed++
        }
    }
    return { removed }
}
