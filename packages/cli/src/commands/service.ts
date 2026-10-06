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
import { runSupervisor } from '@/supervisor'
import { serviceStart, serviceStop, serviceRestart, serviceStatus } from './serviceOps'
import { parseHostPortArgs } from './serviceArgs'
import type { CommandDefinition, CommandContext } from './types'

function showServiceHelp(): void {
    console.log(`
${chalk.bold('mobi service')} - Manage the mobi daemon via supervisor

${chalk.bold('Usage:')}
  mobi service start [--host <host>] [--port <port>]   Start daemon (supervised)
  mobi service stop                                    Stop daemon, supervisor exits
  mobi service restart                                 Restart daemon
  mobi service status                                  Show supervisor/daemon status

${chalk.gray('mobi daemon 顶层命令是 service 子命令的别名')}
`)
}

export const serviceCommand: CommandDefinition = {
    name: 'service',
    requiresRuntimeAssets: true,
    run: async (context: CommandContext) => {
        const args = context.commandArgs

        if (args[0] === '-h' || args[0] === '--help') {
            showServiceHelp()
            return
        }

        // 内部命令：前台运行 supervisor（A 路径由 ensureSupervisorRunning spawn；B 路径由系统服务 ExecStart）
        if (args[0] === 'supervise' && (args[1] === '--sync' || args[1] === 'sync')) {
            await runSupervisor()
            return
        }

        // 解析可选的组件前缀：service daemon <action>（等价于无前缀）
        // daemon/runner 前缀已随单组件模型删除（ticket-22）；旧客户端发的
        // daemon/runner scope 由 supervisor 服务端归一为 daemon
        let actionArgs = args
        if (args[0] === 'daemon') {
            actionArgs = args.slice(1)
        }
        const action = actionArgs[0]

        if (action === 'start') {
            const { host, port } = parseHostPortArgs(actionArgs.slice(1))
            await serviceStart('daemon', { host, port })
            return
        }
        if (action === 'stop') {
            await serviceStop('daemon')
            return
        }
        if (action === 'restart') {
            const { host, port } = parseHostPortArgs(actionArgs.slice(1))
            await serviceRestart('daemon', { host, port })
            return
        }
        if (action === 'status') {
            await serviceStatus()
            return
        }

        showServiceHelp()
    },
}
