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

import chalk from 'chalk'
import { readExitRecords, resolveMobiLogsDir, type ProcessType, type ExitRecord } from '@mobi/shared/exitLogger'

export interface ExitReportOptions {
    /** 打印最近 N 条，默认 20 */
    limit?: number
    /** 仅显示某类进程 */
    processFilter?: ProcessType
    /** 测试注入；默认 resolveMobiLogsDir() */
    logsDir?: string
}

/**
 * 打印 exits.log 最近 N 条记录（时间倒序），供 mobi doctor exits 使用。
 */
export function printExitReport(opts: ExitReportOptions = {}): void {
    const limit = opts.limit ?? 20
    const logsDir = opts.logsDir ?? resolveMobiLogsDir()
    const all = readExitRecords(logsDir)

    const filtered = opts.processFilter
        ? all.filter(r => r.processType === opts.processFilter)
        : all

    const recent = filtered.slice(-limit).reverse()

    if (recent.length === 0) {
        console.log(chalk.gray(`No exit records in ${logsDir}/exits.log`))
        return
    }

    console.log(chalk.bold(`Recent ${recent.length} exit(s)  (${logsDir}/exits.log)`))
    console.log(chalk.gray('─'.repeat(80)))

    for (const r of recent) {
        const reasonColor = colorizeReason(r.reason)
        console.log(
            `${chalk.gray(formatTime(r.timestamp))}  ${tag(r.processType)}  ${reasonColor(r.reason)}  ` +
            `exit=${r.exitCode ?? '-'}  ${r.signal ?? ''}`
        )
        if (r.errorMessage) {
            console.log(chalk.gray(`    ${truncate(r.errorMessage, 120)}`))
        }
        if (r.dumpFile) {
            console.log(chalk.cyan(`    dump: ${logsDir}/${r.dumpFile}`))
        }
    }
}

function tag(t: ProcessType): string {
    const label = t.toUpperCase().padEnd(6)
    const color = t === 'hub' ? chalk.magenta : t === 'runner' ? chalk.blue : chalk.green
    return color(label)
}

function colorizeReason(reason: ExitRecord['reason']): (s: string) => string {
    if (reason === 'killed-externally' || reason.startsWith('crash')) return chalk.red
    if (reason === 'error-exit') return chalk.yellow
    return chalk.gray
}

function formatTime(iso: string): string {
    return iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z')
}

function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n) + '…' : s
}
