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
import { readHubState, type HubLocallyPersistedState } from '@/persistence'
import { startPpidWatchdog } from '@/supervisor/ppidWatchdog'
import { isProcessAlive, killProcess } from '@/utils/process'
import { spawnMobiCli } from '@/utils/spawnMobiCli'
import type { CommandDefinition, CommandContext } from './types'

function parseHubArgs(args: string[]): { host?: string; port?: string } {
    const result: { host?: string; port?: string } = {}

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === '--host' && i + 1 < args.length) {
            result.host = args[++i]
        } else if (arg === '--port' && i + 1 < args.length) {
            result.port = args[++i]
        } else if (arg.startsWith('--host=')) {
            result.host = arg.slice('--host='.length)
        } else if (arg.startsWith('--port=')) {
            result.port = arg.slice('--port='.length)
        }
    }

    return result
}

async function fetchHubHealth(host: string, port: number): Promise<{ status: string; protocolVersion: string } | null> {
    try {
        const response = await fetch(`http://${host}:${port}/health`, {
            signal: AbortSignal.timeout(3000)
        })
        if (!response.ok) return null
        return await response.json() as { status: string; protocolVersion: string }
    } catch {
        return null
    }
}

function showHubHelp(): void {
    console.log(`
${chalk.bold('mobi hub')} - Manage hub server

${chalk.bold('Usage:')}
  mobi hub start [--host <host>] [--port <port>]
                            Start hub in background
  mobi hub stop             Stop hub
  mobi hub restart          Restart hub
  mobi hub status           Show hub status
`)
}

async function getLiveHubState(): Promise<HubLocallyPersistedState | null> {
    const state = await readHubState()

    if (!state) {
        console.log(chalk.yellow('Hub is not running'))
        console.log(chalk.gray('  No hub state file found'))
        return null
    }

    if (!isProcessAlive(state.pid)) {
        console.log(chalk.yellow('Hub is not running'))
        console.log(chalk.gray(`  Process (PID ${state.pid}) is dead`))
        return null
    }

    return state
}

async function waitForHubReady(host: string, port: number, timeoutMs = 10_000): Promise<boolean> {
    const url = `http://${host}:${port}/health`
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
            if (response.ok) return true
        } catch {
            // hub 尚未就绪，继续轮询
        }
        await new Promise(resolve => setTimeout(resolve, 200))
    }

    return false
}

async function runHubStart(commandArgs: string[]): Promise<void> {
    const { host: hostFlag, port: portFlag } = parseHubArgs(commandArgs)

    // 校验 port 参数
    if (portFlag) {
        const portNum = parseInt(portFlag, 10)
        if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
            console.error(chalk.red(`Invalid port: ${portFlag}. Must be a number between 1 and 65535`))
            process.exit(1)
        }
    }

    const env = { ...process.env }
    if (hostFlag) env.MOBI_LISTEN_HOST = hostFlag
    if (portFlag) env.MOBI_LISTEN_PORT = portFlag

    const child = spawnMobiCli(['hub', 'start-sync'], {
        detached: true,
        stdio: 'ignore',
        env,
    })
    child.unref()

    console.log(chalk.gray('Starting hub...'))

    // 确定目标 host/port 用于健康检查
    const host = hostFlag ?? '127.0.0.1'
    // 无 --port flag 时读 profile env（MOBI_LISTEN_PORT），避免早期 banner 打印默认 2222 误导
    const port = portFlag
        ? parseInt(portFlag, 10)
        : (process.env.MOBI_LISTEN_PORT ? parseInt(process.env.MOBI_LISTEN_PORT, 10) : 2222)

    const ready = await waitForHubReady(host, port)
    if (!ready) {
        console.error(chalk.red('Failed to start hub'))
        process.exit(1)
    }

    const health = await fetchHubHealth(host, port)
    console.log(chalk.green(`Hub started (PID ${child.pid})`))
    console.log(`  Web URL:   ${chalk.cyan(`http://localhost:${port}`)}`)
    if (health) {
        console.log(`  Health:    ${chalk.green(health.status)}`)
        console.log(`  Protocol:  v${health.protocolVersion}`)
    }
    process.exit(0)
}

async function runHubStatus(): Promise<void> {
    const state = await getLiveHubState()
    if (!state) return

    const health = await fetchHubHealth(state.listenHost, state.listenPort)

    console.log(chalk.green('Hub is running'))
    console.log(`  PID:         ${state.pid}`)
    console.log(`  Listen:      ${state.listenHost}:${state.listenPort}`)
    console.log(`  Web URL:     ${chalk.cyan(`http://localhost:${state.listenPort}`)}`)
    console.log(`  Started at:  ${state.startTime}`)
    if (health) {
        console.log(`  Health:      ${chalk.green(health.status)}`)
        console.log(`  Protocol:    v${health.protocolVersion}`)
    }
}

async function runHubStop(): Promise<boolean> {
    const state = await getLiveHubState()
    if (!state) return true

    console.log(`Stopping hub (PID ${state.pid})...`)

    const killed = await killProcess(state.pid)
    if (killed) {
        console.log(chalk.green('Hub stopped'))
    } else {
        console.log(chalk.red('Failed to stop hub'))
    }
    return killed
}

export const hubCommand: CommandDefinition = {
    name: 'hub',
    requiresRuntimeAssets: true,
    run: async (context: CommandContext) => {
        const subcommand = context.commandArgs[0]

        if (subcommand === '-h' || subcommand === '--help') {
            showHubHelp()
            return
        }

        if (subcommand === 'start') {
            await runHubStart(context.commandArgs.slice(1))
            return
        }

        if (subcommand === 'start-sync') {
            const { host, port } = parseHubArgs(context.commandArgs.slice(1))
            if (host) process.env.MOBI_LISTEN_HOST = host
            if (port) process.env.MOBI_LISTEN_PORT = port
            // 父进程（supervisor，或前台调试时的 shell）死亡时自杀，
            // 避免孤儿 hub 占端口/状态文件（SIGTERM 走 hub 既有优雅清理）
            startPpidWatchdog({
                onOrphaned: () => process.kill(process.pid, 'SIGTERM'),
            })
            await import('../../../hub/src/index')
            return
        }

        if (subcommand === 'status') {
            await runHubStatus()
            process.exit(0)
        }

        if (subcommand === 'stop') {
            const stopped = await runHubStop()
            process.exit(stopped ? 0 : 1)
        }

        if (subcommand === 'restart') {
            const stopped = await runHubStop()
            if (!stopped) {
                console.error(chalk.red('Cannot restart: failed to stop hub'))
                process.exit(1)
            }
            await runHubStart(context.commandArgs.slice(1))
            return
        }

        showHubHelp()
    }
}
