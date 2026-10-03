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
 * `mobi service` / `mobi daemon` 两个入口都走这里，保证语义唯一。
 *
 * start/restart 会主动拉起 supervisor；status/stop 只探活不拉起，
 * 避免只读查询在冷启动时意外唤醒 supervisor 并按 desired state 恢复整套服务。
 */

import chalk from 'chalk'
import { configuration } from '@mobi/node-core/configuration'
import { ensureSupervisorRunning, sendControlCommand, type ServiceScope } from '@/supervisor/control'
import { readDesiredState } from '@/supervisor/desiredState'
import type { ComponentStatusReport } from '@/supervisor/supervisor'

export interface StartOptions {
    host?: string
    port?: number
}

interface ServiceStatusPayload {
    pid: number
    daemon: ComponentStatusReport
}

const LABEL: Record<ComponentStatusReport['name'], string> = { daemon: 'Daemon' }

function colorStatus(status: ComponentStatusReport['status']): string {
    if (status === 'running') return chalk.green('running')
    if (status === 'failed') return chalk.red('failed')
    if (status === 'backoff') return chalk.yellow('backoff')
    return chalk.gray('stopped')
}

/** 展示用的期望状态摘要（supervisor 未运行时也能显示配置） */
function readDesiredLite(): { daemon: boolean; port: number } {
    const state = readDesiredState()
    return { daemon: state?.daemon ?? false, port: state?.port ?? 2222 }
}

/**
 * start/restart 的 IPC 客户端超时。
 * 服务端 start 的健康门最长 30s（HUB_HEALTH_TIMEOUT_MS），外加
 * ensureSupervisorRunning 的 spawn 就绪期；默认 10s 会在 daemon 启动慢时
 * 假报失败而服务实际成功，故显式放宽到 60s。
 */
const START_COMMAND_TIMEOUT_MS = 60_000

/** 探活：supervisor 未运行返回 false（不拉起） */
async function isSupervisorAlive(): Promise<boolean> {
    try {
        await sendControlCommand(configuration.supervisorSocketFile, { cmd: 'status' }, 2_000)
        return true
    } catch {
        return false
    }
}

/** 控制指令失败时打印友好错误并退出，避免裸栈 */
async function runControlAction(action: () => Promise<void>): Promise<void> {
    try {
        await action()
    } catch (error) {
        console.error(chalk.red(error instanceof Error ? error.message : String(error)))
        process.exit(1)
    }
}

function printStatus(payload: ServiceStatusPayload): void {
    const desired = readDesiredLite()
    console.log(chalk.bold('Service Status'))
    console.log('')
    console.log(`  Supervisor: ${chalk.green('running')} (PID ${payload.pid})`)
    const report = payload.daemon
    const pidText = report.pid ? ` (PID ${report.pid})` : ''
    const crashText = report.consecutiveCrashes > 0
        ? chalk.gray(` [连续崩溃 ${report.consecutiveCrashes}]`)
        : ''
    console.log(`  ${LABEL[report.name].padEnd(9)}: ${colorStatus(report.status)}${pidText}${crashText}`)
    if (desired.daemon) {
        console.log(`  Web URL:   ${chalk.cyan(`http://localhost:${desired.port}`)}`)
    }
    if (report.status === 'failed') {
        console.log('')
        console.log(chalk.yellow('  daemon 处于 failed 状态，崩溃现场见 ~/.mobi/logs/daemon-crash.log'))
    }
}

export async function serviceStart(scope: ServiceScope, options: StartOptions = {}): Promise<void> {
    await runControlAction(async () => {
        await ensureSupervisorRunning()
        const payload = await sendControlCommand(
            configuration.supervisorSocketFile,
            {
                cmd: 'start',
                scope,
                host: options.host,
                port: options.port,
            },
            // 服务端健康门最长 30s + spawn 就绪期，默认 10s 会假报失败
            START_COMMAND_TIMEOUT_MS,
        ) as ServiceStatusPayload
        printStatus(payload)
        if (payload.daemon.status === 'running') {
            const desired = readDesiredLite()
            console.log('')
            console.log(chalk.green(`Service ready at ${chalk.cyan(`http://localhost:${desired.port}`)}`))
        }
    })
}

export async function serviceStop(scope: ServiceScope): Promise<void> {
    void scope // 单组件模型下 stop 恒为 daemon；保留参数与 start/restart 形状一致
    // 只探活不拉起：本来没跑就没必要（也不应该）唤醒 supervisor 再停它
    if (!(await isSupervisorAlive())) {
        console.log(chalk.yellow('Service is not running'))
        return
    }
    await runControlAction(async () => {
        await sendControlCommand(configuration.supervisorSocketFile, { cmd: 'stop', scope: 'daemon' })
        console.log(chalk.green('Service stopped'))
    })
}

export async function serviceRestart(scope: ServiceScope, options: StartOptions = {}): Promise<void> {
    await runControlAction(async () => {
        await ensureSupervisorRunning()
        const payload = await sendControlCommand(
            configuration.supervisorSocketFile,
            {
                cmd: 'restart',
                scope,
                host: options.host,
                port: options.port,
            },
            // 与 serviceStart 同理：服务端 start 路径健康门最长 30s
            START_COMMAND_TIMEOUT_MS,
        ) as ServiceStatusPayload
        printStatus(payload)
    })
}

export async function serviceStatus(): Promise<void> {
    // 只读查询绝不拉起 supervisor（否则 desired state 非空时会意外恢复整套服务）
    if (!(await isSupervisorAlive())) {
        console.log(chalk.yellow('Service is not running'))
        return
    }
    await runControlAction(async () => {
        const payload = await sendControlCommand(configuration.supervisorSocketFile, {
            cmd: 'status',
        }) as ServiceStatusPayload
        printStatus(payload)
    })
}
