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
import { isProcessAlive, killProcess } from '@/utils/process'
import { spawnMobiCli } from '@/utils/spawnMobiCli'

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
 * 按顺序重启 hub 和 runner
 * 顺序：先停 runner（依赖 hub）→ 停 hub → 启动 hub → 启动 runner
 */
export async function restartProcesses(): Promise<void> {
    // 1. 停止 runner
    const runnerState = await readRunnerState()
    if (runnerState && isProcessAlive(runnerState.pid)) {
        console.log(chalk.gray('Stopping runner...'))
        await killProcess(runnerState.pid)
    }

    // 2. 停止 hub
    const hubState = await readHubState()
    if (hubState && isProcessAlive(hubState.pid)) {
        console.log(chalk.gray('Stopping hub...'))
        await killProcess(hubState.pid)
    }

    // 3. 启动 hub
    console.log(chalk.gray('Starting hub...'))
    const hubChild = spawnMobiCli(['hub'], {
        detached: true,
        stdio: 'ignore',
    })
    hubChild.unref()

    // 等待 hub 就绪
    await new Promise(resolve => setTimeout(resolve, 2000))

    // 4. 启动 runner
    console.log(chalk.gray('Starting runner...'))
    const runnerChild = spawnMobiCli(['runner', 'start-sync'], {
        detached: true,
        stdio: 'ignore',
    })
    runnerChild.unref()

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
