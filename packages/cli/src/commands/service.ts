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
import type { CommandDefinition, CommandContext } from './types'

async function waitForHubReady(host: string, port: number, timeoutMs = 10_000): Promise<boolean> {
    const url = `http://${host}:${port}/health`
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
            if (response.ok) return true
        } catch {
            // hub 尚未就绪
        }
        await new Promise(resolve => setTimeout(resolve, 200))
    }

    return false
}

async function runServiceStart(context: CommandContext): Promise<void> {
    // 解析 host/port
    const args = context.commandArgs.slice(1)
    let host = '127.0.0.1'
    let port = 2222
    for (let i = 0; i < args.length; i++) {
        if ((args[i] === '--host' || args[i] === '--port') && i + 1 < args.length) {
            if (args[i] === '--host') host = args[++i]
            else port = parseInt(args[++i], 10)
        } else if (args[i].startsWith('--host=')) {
            host = args[i].slice('--host='.length)
        } else if (args[i].startsWith('--port=')) {
            port = parseInt(args[i].slice('--port='.length), 10)
        }
    }

    // 启动 hub
    console.log(chalk.gray('Starting hub...'))
    const hubEnv = { ...process.env }
    hubEnv.MOBI_LISTEN_HOST = host
    hubEnv.MOBI_LISTEN_PORT = String(port)

    const hubChild = spawnMobiCli(['hub', 'start-sync'], {
        detached: true,
        stdio: 'ignore',
        env: hubEnv,
    })
    hubChild.unref()

    const ready = await waitForHubReady(host, port)
    if (!ready) {
        console.error(chalk.red('Hub failed to start'))
        process.exit(1)
    }
    console.log(chalk.green(`Hub started (PID ${hubChild.pid})`))

    // 启动 runner
    console.log(chalk.gray('Starting runner...'))
    const runnerChild = spawnMobiCli(['runner', 'start-sync'], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
    })
    runnerChild.unref()
    console.log(chalk.green(`Runner started (PID ${runnerChild.pid})`))

    console.log('')
    console.log(`Service ready at ${chalk.cyan(`http://localhost:${port}`)}`)
}

async function runServiceStop(): Promise<void> {
    // 先停 runner
    const runnerState = await readRunnerState()
    if (runnerState && isProcessAlive(runnerState.pid)) {
        console.log(chalk.gray(`Stopping runner (PID ${runnerState.pid})...`))
        await killProcess(runnerState.pid)
        console.log(chalk.green('Runner stopped'))
    } else {
        console.log(chalk.gray('Runner is not running'))
    }

    // 再停 hub
    const hubState = await readHubState()
    if (hubState && isProcessAlive(hubState.pid)) {
        console.log(chalk.gray(`Stopping hub (PID ${hubState.pid})...`))
        await killProcess(hubState.pid)
        console.log(chalk.green('Hub stopped'))
    } else {
        console.log(chalk.gray('Hub is not running'))
    }
}

async function runServiceRestart(context: CommandContext): Promise<void> {
    await runServiceStop()
    console.log('')
    await runServiceStart(context)
}

async function runServiceStatus(): Promise<void> {
    const hubState = await readHubState()
    const runnerState = await readRunnerState()

    console.log(chalk.bold('Service Status'))
    console.log('')

    // Hub
    if (hubState && isProcessAlive(hubState.pid)) {
        console.log(`  Hub:       ${chalk.green('running')} (PID ${hubState.pid})`)
        console.log(`  Listen:    ${hubState.listenHost}:${hubState.listenPort}`)
        console.log(`  Web URL:   ${chalk.cyan(`http://localhost:${hubState.listenPort}`)}`)

        try {
            const response = await fetch(`http://${hubState.listenHost}:${hubState.listenPort}/health`, {
                signal: AbortSignal.timeout(3000),
            })
            if (response.ok) {
                const health = await response.json() as { status: string; protocolVersion: string }
                console.log(`  Health:    ${chalk.green(health.status)}`)
            }
        } catch {
            console.log(`  Health:    ${chalk.yellow('unreachable')}`)
        }
    } else {
        console.log(`  Hub:       ${chalk.gray('stopped')}`)
    }

    console.log('')

    // Runner
    if (runnerState && isProcessAlive(runnerState.pid)) {
        console.log(`  Runner:    ${chalk.green('running')} (PID ${runnerState.pid})`)
    } else {
        console.log(`  Runner:    ${chalk.gray('stopped')}`)
    }
}

function showServiceHelp(): void {
    console.log(`
${chalk.bold('mobi service')} - Manage hub + runner together

${chalk.bold('Usage:')}
  mobi service start [--host <host>] [--port <port>]
                            Start hub and runner
  mobi service stop         Stop hub and runner
  mobi service restart      Restart hub and runner
  mobi service status       Show service status
`)
}

export const serviceCommand: CommandDefinition = {
    name: 'service',
    requiresRuntimeAssets: true,
    run: async (context: CommandContext) => {
        const subcommand = context.commandArgs[0]

        if (subcommand === '-h' || subcommand === '--help') {
            showServiceHelp()
            return
        }

        if (subcommand === 'start') {
            await runServiceStart(context)
            return
        }

        if (subcommand === 'stop') {
            await runServiceStop()
            return
        }

        if (subcommand === 'restart') {
            await runServiceRestart(context)
            return
        }

        if (subcommand === 'status') {
            await runServiceStatus()
            return
        }

        showServiceHelp()
    }
}
