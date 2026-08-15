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
import type { ServiceScope } from '@/supervisor/control'
import type { CommandDefinition, CommandContext } from './types'

function showServiceHelp(): void {
    console.log(`
${chalk.bold('mobi service')} - Manage hub + runner via supervisor

${chalk.bold('Usage:')}
  mobi service start [--host <host>] [--port <port>]   Start hub and runner (supervised)
  mobi service stop                                    Stop hub and runner, supervisor exits
  mobi service restart                                 Restart hub and runner
  mobi service status                                  Show supervisor/hub/runner status

  mobi service hub <start|stop|restart|status>          Manage hub only
  mobi service runner <start|stop|restart|status>       Manage runner only

${chalk.gray('mobi hub / mobi runner 顶层命令是 service 子命令的别名')}
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

        // 解析可选的组件前缀：service [hub|runner] <action>
        let scope: ServiceScope = 'both'
        let actionArgs = args
        if (args[0] === 'hub' || args[0] === 'runner') {
            scope = args[0]
            actionArgs = args.slice(1)
        }
        const action = actionArgs[0]

        if (action === 'start') {
            const { host, port } = parseHostPortArgs(actionArgs.slice(1))
            await serviceStart(scope, { host, port })
            return
        }
        if (action === 'stop') {
            await serviceStop(scope)
            return
        }
        if (action === 'restart') {
            const { host, port } = parseHostPortArgs(actionArgs.slice(1))
            await serviceRestart(scope, { host, port })
            return
        }
        if (action === 'status') {
            await serviceStatus()
            return
        }

        showServiceHelp()
    },
}
