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
import { readHubState, readRunnerState } from '@/persistence'
import { isProcessAlive } from '@/utils/process'

export interface ProcessInfo {
    pid: number
    running: boolean
}

export interface ActiveProcesses {
    hub: ProcessInfo | null
    runner: ProcessInfo | null
}

/**
 * 检测当前活跃的 mobi 进程
 */
export async function detectActiveProcesses(): Promise<ActiveProcesses> {
    const hubState = await readHubState()
    const runnerState = await readRunnerState()

    const hub: ProcessInfo | null = hubState
        ? { pid: hubState.pid, running: isProcessAlive(hubState.pid) }
        : null

    const runner: ProcessInfo | null = runnerState
        ? { pid: runnerState.pid, running: isProcessAlive(runnerState.pid) }
        : null

    return { hub, runner }
}

/**
 * 重启 hub 和 runner
 * 使用 mobi service restart 子命令
 */
export async function restartProcesses(): Promise<void> {
    console.log(chalk.gray('Restarting service...'))
    const { execFileSync } = await import('node:child_process')
    const { getMobiCliCommand } = await import('@/utils/spawnMobiCli')

    // 获取 hub 的 host/port 透传给 service restart
    const hubState = await readHubState()
    const args = ['service', 'restart']
    if (hubState?.listenHost && hubState.listenHost !== '127.0.0.1') {
        args.push('--host', hubState.listenHost)
    }
    if (hubState?.listenPort && hubState.listenPort !== 2222) {
        args.push('--port', String(hubState.listenPort))
    }

    const cmd = getMobiCliCommand(args)
    try {
        execFileSync(cmd.command, cmd.args, { stdio: 'pipe', timeout: 30_000 })
    } catch {
        console.error(chalk.yellow('Service restart failed'))
        return
    }

    console.log(chalk.green('Hub and runner restarted'))
}

/**
 * 格式化活跃进程提示
 */
export function formatActiveProcessesPrompt(processes: ActiveProcesses): string {
    const parts: string[] = []
    if (processes.hub?.running) {
        parts.push(`Hub (PID ${processes.hub.pid})`)
    }
    if (processes.runner?.running) {
        parts.push(`Runner (PID ${processes.runner.pid})`)
    }

    if (parts.length === 0) return ''

    return `${parts.join(' and ')} ${parts.length > 1 ? 'are' : 'is'} running. Restart now?`
}

/**
 * 检查是否有活跃进程
 */
export function hasActiveProcesses(processes: ActiveProcesses): boolean {
    return (processes.hub?.running ?? false) || (processes.runner?.running ?? false)
}
