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
 * service 命令族共用的 CLI 侧操作：确保 supervisor 存活 → 发控制指令 → 打印结果。
 * `mobi service`、`mobi hub`、`mobi runner` 三个入口都走这里，保证语义唯一。
 */

import chalk from 'chalk'
import { configuration } from '@/configuration'
import { ensureSupervisorRunning, sendControlCommand, type ServiceScope } from '@/supervisor/control'
import { readDesiredState } from '@/supervisor/desiredState'

export interface StartOptions {
    host?: string
    port?: number
}

interface ComponentReport {
    name: 'hub' | 'runner'
    managed: boolean
    status: 'stopped' | 'running' | 'backoff' | 'failed'
    pid?: number
    consecutiveCrashes: number
}

interface ServiceStatusPayload {
    pid: number
    hub: ComponentReport
    runner: ComponentReport
}

const LABEL: Record<'hub' | 'runner', string> = { hub: 'Hub', runner: 'Runner' }

function colorStatus(status: ComponentReport['status']): string {
    if (status === 'running') return chalk.green('running')
    if (status === 'failed') return chalk.red('failed')
    if (status === 'backoff') return chalk.yellow('backoff')
    return chalk.gray('stopped')
}

/** 展示用的期望状态摘要（supervisor 未运行时也能显示配置） */
function readDesiredLite(): { hub: boolean; port: number } {
    const state = readDesiredState()
    return { hub: state?.hub ?? false, port: state?.port ?? 2222 }
}

function printStatus(payload: ServiceStatusPayload): void {
    const desired = readDesiredLite()
    console.log(chalk.bold('Service Status'))
    console.log('')
    console.log(`  Supervisor: ${chalk.green('running')} (PID ${payload.pid})`)
    for (const report of [payload.hub, payload.runner]) {
        const pidText = report.pid ? ` (PID ${report.pid})` : ''
        const crashText = report.consecutiveCrashes > 0
            ? chalk.gray(` [连续崩溃 ${report.consecutiveCrashes}]`)
            : ''
        console.log(`  ${LABEL[report.name].padEnd(9)}: ${colorStatus(report.status)}${pidText}${crashText}`)
    }
    if (desired.hub) {
        console.log(`  Web URL:   ${chalk.cyan(`http://localhost:${desired.port}`)}`)
    }
    if (payload.hub.status === 'failed' || payload.runner.status === 'failed') {
        console.log('')
        console.log(chalk.yellow('  有组件处于 failed 状态，崩溃现场见 ~/.mobi/logs/<组件>-crash.log'))
    }
}

export async function serviceStart(scope: ServiceScope, options: StartOptions = {}): Promise<void> {
    await ensureSupervisorRunning()
    const payload = await sendControlCommand(configuration.supervisorSocketFile, {
        cmd: 'start',
        scope,
        host: options.host,
        port: options.port,
    }) as ServiceStatusPayload
    printStatus(payload)
    const desired = readDesiredLite()
    console.log('')
    console.log(chalk.green(`Service ready at ${chalk.cyan(`http://localhost:${desired.port}`)}`))
}

export async function serviceStop(scope: ServiceScope): Promise<void> {
    await ensureSupervisorRunning()
    await sendControlCommand(configuration.supervisorSocketFile, { cmd: 'stop', scope })
    if (scope === 'both') {
        console.log(chalk.green('Service stopped'))
    } else {
        console.log(chalk.green(`${LABEL[scope]} stopped`))
    }
}

export async function serviceRestart(scope: ServiceScope, options: StartOptions = {}): Promise<void> {
    await ensureSupervisorRunning()
    const payload = await sendControlCommand(configuration.supervisorSocketFile, {
        cmd: 'restart',
        scope,
        host: options.host,
        port: options.port,
    }) as ServiceStatusPayload
    printStatus(payload)
}

export async function serviceStatus(): Promise<void> {
    await ensureSupervisorRunning()
    const payload = await sendControlCommand(configuration.supervisorSocketFile, {
        cmd: 'status',
    }) as ServiceStatusPayload
    printStatus(payload)
}
