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
import { startPpidWatchdog } from '@/supervisor/ppidWatchdog'
import { serviceStart, serviceStop, serviceRestart, serviceStatus } from './serviceOps'
import { parseHostPortArgs } from './serviceArgs'
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

function showHubHelp(): void {
    console.log(`
${chalk.bold('mobi hub')} - Manage hub server

${chalk.bold('Usage:')}
  mobi hub start [--host <host>] [--port <port>]
                            Start hub (supervised, via mobi service hub start)
  mobi hub stop             Stop hub
  mobi hub restart          Restart hub
  mobi hub status           Show hub status
`)
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
            const { host, port } = parseHostPortArgs(context.commandArgs.slice(1))
            await serviceStart('hub', { host, port })
            process.exit(0)
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
            await serviceStatus()
            process.exit(0)
        }

        if (subcommand === 'stop') {
            await serviceStop('hub')
            process.exit(0)
        }

        if (subcommand === 'restart') {
            const { host, port } = parseHostPortArgs(context.commandArgs.slice(1))
            await serviceRestart('hub', { host, port })
            process.exit(0)
        }

        showHubHelp()
    },
}
