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
import { readDaemonState } from '@mobi/node-core/persistence'
import { isProcessAlive } from '@mobi/node-core/utils/process'

export interface ProcessInfo {
    pid: number
    running: boolean
}

export interface ActiveProcesses {
    daemon: ProcessInfo | null
}

/**
 * 检测当前活跃的 mobi 进程（ticket-22 起单组件：daemon.state.json 的 pid）
 */
export async function detectActiveProcesses(): Promise<ActiveProcesses> {
    const state = await readDaemonState()

    const daemon: ProcessInfo | null = state
        ? { pid: state.pid, running: isProcessAlive(state.pid) }
        : null

    return { daemon }
}

/**
 * 重启 daemon（单进程，一次重启即全量替换为新版二进制）
 * 使用 mobi service restart 子命令
 */
export async function restartProcesses(): Promise<void> {
    console.log(chalk.gray('Restarting service...'))
    const { execFileSync } = await import('node:child_process')
    const { getMobiCliCommand } = await import('@mobi/node-core/utils/spawnMobiCli')

    // 透传当前监听端口给 service restart（非默认端口时）
    const state = await readDaemonState()
    const args = ['service', 'restart']
    // 502 读旧写新：新名 httpPort，存量旧名 hubPort 兜底
    const httpPort = state ? (state.httpPort ?? (state as typeof state & { hubPort?: number }).hubPort) : undefined;
    if (httpPort && httpPort !== 2222) {
        args.push('--port', String(httpPort))
    }

    const cmd = getMobiCliCommand(args)
    try {
        execFileSync(cmd.command, cmd.args, { stdio: 'pipe', timeout: 30_000 })
    } catch {
        console.error(chalk.yellow('Service restart failed'))
        return
    }

    console.log(chalk.green('Daemon restarted'))
}

/**
 * 格式化活跃进程提示
 */
export function formatActiveProcessesPrompt(processes: ActiveProcesses): string {
    if (!processes.daemon?.running) return ''
    return `Daemon (PID ${processes.daemon.pid}) is running. Restart now?`
}

/**
 * 检查是否有活跃进程
 */
export function hasActiveProcesses(processes: ActiveProcesses): boolean {
    return processes.daemon?.running ?? false
}
