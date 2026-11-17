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
import { initializeToken } from '@/ui/tokenInit'
import { parseHostPortArgs } from './serviceArgs'
import { serviceStart, serviceStop, serviceRestart, serviceStatus } from './serviceOps'
import type { CommandDefinition, CommandContext } from './types'

function showDaemonHelp(): void {
    console.log(`
${chalk.bold('mobi daemon')} - Manage the single-process daemon

${chalk.bold('Usage:')}
  mobi daemon start [--host <host>] [--port <port>]
                            Start daemon (supervised, via mobi service daemon start)
  mobi daemon stop             Stop daemon (sessions stay alive)
  mobi daemon restart          Restart daemon
  mobi daemon status           Show daemon status
`)
}

export const daemonCommand: CommandDefinition = {
    name: 'daemon',
    requiresRuntimeAssets: true,
    run: async (context: CommandContext) => {
        const subcommand = context.commandArgs[0]

        if (subcommand === '-h' || subcommand === '--help') {
            showDaemonHelp()
            return
        }

        if (subcommand === 'start') {
            const { host, port } = parseHostPortArgs(context.commandArgs.slice(1))
            await serviceStart('daemon', { host, port })
            return
        }

        if (subcommand === 'start-sync') {
            const { host, port } = parseHostPortArgs(context.commandArgs.slice(1))
            // 父进程（supervisor，或前台调试时的 shell）死亡时自杀，
            // 避免孤儿 daemon 占端口/锁/状态文件（SIGTERM 走 daemon 优雅清理）
            startPpidWatchdog({
                onOrphaned: () => process.kill(process.pid, 'SIGTERM'),
            })
            // 同进程 executor 需要 CLI token 连本进程 daemon 认证
            await initializeToken()
            // skills 包在模块加载时快照 clone 超时（默认 300s——慢网下用户只看到「卡住」）。
            // 获取清单/安装是交互式动作，90s 无进展即失败可重试；需要更久可显式设大
            process.env.SKILLS_CLONE_TIMEOUT_MS ??= '90000'
            const { startDaemon } = await import('@mobi/daemon/daemonEntry')
            await startDaemon({ host, port })
            return
        }

        if (subcommand === 'status') {
            await serviceStatus()
            return
        }

        if (subcommand === 'stop') {
            await serviceStop('daemon')
            return
        }

        if (subcommand === 'restart') {
            const { host, port } = parseHostPortArgs(context.commandArgs.slice(1))
            await serviceRestart('daemon', { host, port })
            return
        }

        showDaemonHelp()
    },
}
