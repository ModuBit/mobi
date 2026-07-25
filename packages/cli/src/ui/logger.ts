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
 * cli Logger：基于 shared BaseLogger（统一落盘 / 格式 / ringBuffer / console 着色），
 * 额外保留 cli 特有能力：
 * - 远程日志（DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING）
 * - debugLargeJson（大对象截断落盘）
 *
 * 文件名按 processType 分：runner → {ts}-runner.log，交互 → {ts}-cli.log。
 */

import chalk from 'chalk'
import {
    BaseLogger,
    createTimestampForFilename,
    createTimestampForLogEntry,
    type LogLevel,
} from '@mobi/shared/logger'
import { configuration } from '@/configuration'
import { appendFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { readRunnerState } from '@/persistence'

/** 按 configuration.processType 解析本次会话的日志文件路径 */
function sessionLogPath(): string {
    const timestamp = createTimestampForFilename()
    return join(configuration.logsDir, `${timestamp}-${configuration.processType}.log`)
}

export class Logger extends BaseLogger {
    private dangerouslyUnencryptedServerLoggingUrl: string | undefined

    constructor(
        logFilePath: string = sessionLogPath(),
        options?: { ringBufferCapacity?: number },
    ) {
        super(configuration.processType, configuration.logsDir, logFilePath, options)
        // 仅在显式开启且配置了 API URL 时启用远程日志
        if (
            process.env.DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING &&
            process.env.MOBI_API_URL
        ) {
            this.dangerouslyUnencryptedServerLoggingUrl = process.env.MOBI_API_URL
            console.log(chalk.yellow('[REMOTE LOGGING] Sending logs to server for AI debugging'))
        }
    }

    /**
     * override：落盘前追加远程上报（若启用）。
     * 调 super.writeLine 完成统一的落盘 + ringBuffer。
     */
    protected writeLine(level: LogLevel, message: string, ...args: unknown[]): void {
        if (this.dangerouslyUnencryptedServerLoggingUrl) {
            // fire-and-forget，显式 catch 避免未处理 rejection
            this.sendToRemoteServer(level, message, ...args).catch(() => {
                // 静默，不打扰会话
            })
        }
        super.writeLine(level, message, ...args)
    }

    /**
     * 大对象截断后落盘（多行 JSON）。生产环境默认跳过内容，仅记一条 debug 提示。
     */
    debugLargeJson(
        message: string,
        object: unknown,
        maxStringLength: number = 100,
        maxArrayLength: number = 10,
    ): void {
        // 生产模式完全静默：既不落盘也不进 ringBuffer
        // （大 JSON 会挤占 ringBuffer 配额，且每条 SDK 消息都调用，是日志风暴主因）
        if (!process.env.DEBUG) {
            return
        }

        const truncateStrings = (obj: unknown): unknown => {
            if (typeof obj === 'string') {
                return obj.length > maxStringLength
                    ? obj.substring(0, maxStringLength) + '... [truncated for logs]'
                    : obj
            }

            if (Array.isArray(obj)) {
                const truncatedArray = obj.map(item => truncateStrings(item)).slice(0, maxArrayLength)
                if (obj.length > maxArrayLength) {
                    truncatedArray.push(`... [truncated array for logs up to ${maxArrayLength} items]` as unknown)
                }
                return truncatedArray
            }

            if (obj && typeof obj === 'object') {
                const result: Record<string, unknown> = {}
                for (const [key, value] of Object.entries(obj)) {
                    if (key === 'usage') {
                        // usage 对排障无用，丢弃
                        continue
                    }
                    result[key] = truncateStrings(value)
                }
                return result
            }

            return obj
        }

        const truncatedObject = truncateStrings(object)
        const json = JSON.stringify(truncatedObject, null, 2)
        const ts = createTimestampForLogEntry()
        // 多行格式：首行统一前缀，次行起为 JSON
        const line = `[${ts}] [${this.processType}] DEBUG ${message}\n${json}\n`
        try {
            appendFileSync(this.logFilePath, line)
        } catch {
            // best-effort，不打扰会话
        }
    }

    /** 仅 DEBUG 模式下输出到 console；始终写 debug 文件 */
    infoDeveloper(message: string, ...args: unknown[]): void {
        this.debug(message, ...args)

        if (process.env.DEBUG) {
            this.logToConsole('info', `[DEV] ${message}`, ...args)
        }
    }

    /** 兼容旧调用方：返回最近 N 条 */
    getRecentEntries(): string[] {
        return this.snapshot()
    }

    /** 兼容旧调用方：本地时区时间戳 */
    localTimezoneTimestamp(): string {
        return createTimestampForLogEntry()
    }

    private async sendToRemoteServer(level: string, message: string, ...args: unknown[]): Promise<void> {
        if (!this.dangerouslyUnencryptedServerLoggingUrl) return

        try {
            await fetch(this.dangerouslyUnencryptedServerLoggingUrl + '/logs-combined-from-cli-and-mobile-for-simple-ai-debugging', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level,
                    message: `${message} ${args.map(a =>
                        typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
                    ).join(' ')}`,
                    source: this.processType,
                    platform: process.platform,
                }),
            })
        } catch {
            // 静默失败，避免干扰会话
        }
    }
}

// 启动即初始化
export const logger = new Logger()

/**
 * Information about a log file on disk
 */
export type LogFileInfo = {
    file: string;
    path: string;
    modified: Date;
};

/**
 * List runner log files in descending modification time order.
 * Returns up to `limit` entries; empty array if none.
 */
export async function listRunnerLogFiles(limit: number = 50): Promise<LogFileInfo[]> {
    try {
        const logsDir = configuration.logsDir;
        if (!existsSync(logsDir)) {
            return [];
        }

        const logs = readdirSync(logsDir)
            .filter(file => file.endsWith('-runner.log'))
            .map(file => {
                const fullPath = join(logsDir, file);
                const stats = statSync(fullPath);
                return { file, path: fullPath, modified: stats.mtime } as LogFileInfo;
            })
            .sort((a, b) => b.modified.getTime() - a.modified.getTime());

        // Prefer the path persisted by the runner if present (return 0th element if present)
        try {
            const state = await readRunnerState();

            if (!state) {
                return logs;
            }

            if (state.runnerLogPath && existsSync(state.runnerLogPath)) {
                const stats = statSync(state.runnerLogPath);
                const persisted: LogFileInfo = {
                    file: basename(state.runnerLogPath),
                    path: state.runnerLogPath,
                    modified: stats.mtime
                };
                const idx = logs.findIndex(l => l.path === persisted.path);
                if (idx >= 0) {
                    const [found] = logs.splice(idx, 1);
                    logs.unshift(found);
                } else {
                    logs.unshift(persisted);
                }
            }
        } catch {
            // Ignore errors reading runner state; fall back to directory listing
        }

        return logs.slice(0, Math.max(0, limit));
    } catch {
        return [];
    }
}

/**
 * Get the most recent runner log file, or null if none exist.
 */
export async function getLatestRunnerLog(): Promise<LogFileInfo | null> {
    const [latest] = await listRunnerLogFiles(1);
    return latest || null;
}
