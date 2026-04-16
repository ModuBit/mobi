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
import { isProcessAlive, killProcess } from '@/utils/process'
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

/**
 * 读取 Hub 状态并校验进程是否存活
 * 供 status/stop 子命令复用
 */
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

async function runHubStatus(): Promise<void> {
    const state = await getLiveHubState()
    if (!state) return

    const health = await fetchHubHealth(state.listenHost, state.listenPort)

    console.log(chalk.green('Hub is running'))
    console.log(`  PID:         ${state.pid}`)
    console.log(`  Listen:      ${state.listenHost}:${state.listenPort}`)
    console.log(`  Local URL:   http://localhost:${state.listenPort}`)
    console.log(`  Started at:  ${state.startTime}`)
    if (health) {
        console.log(`  Health:      ${chalk.green(health.status)}`)
        console.log(`  Protocol:    v${health.protocolVersion}`)
    }
}

async function runHubStop(): Promise<void> {
    const state = await getLiveHubState()
    if (!state) return

    console.log(`Stopping hub (PID ${state.pid})...`)

    const killed = await killProcess(state.pid)
    console.log(killed ? chalk.green('Hub stopped') : chalk.red('Failed to stop hub'))
}

export const hubCommand: CommandDefinition = {
    name: 'hub',
    requiresRuntimeAssets: true,
    run: async (context: CommandContext) => {
        const subcommand = context.commandArgs[0]

        if (subcommand === 'status') {
            await runHubStatus()
            process.exit(0)
        }

        if (subcommand === 'stop') {
            await runHubStop()
            process.exit(0)
        }

        try {
            const { host, port } = parseHubArgs(context.commandArgs)

            if (host) {
                process.env.MOBI_LISTEN_HOST = host
            }
            if (port) {
                process.env.MOBI_LISTEN_PORT = port
            }
            await import('../../../hub/src/index')
        } catch (error) {
            console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error')
            if (process.env.DEBUG) {
                console.error(error)
            }
            process.exit(1)
        }
    }
}
