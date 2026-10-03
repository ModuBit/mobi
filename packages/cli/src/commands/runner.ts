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
 * `mobi runner` 命令：会话管理工具族（list / stop-session / logs）。
 *
 * start/stop/restart/status/start-sync 别名已随单组件模型删除（ticket-22）：
 * runner 与 hub 同进程为 daemon，进程级操作走 `mobi daemon` / `mobi service`。
 */

import chalk from 'chalk'
import {
    listRunnerSessions,
    stopRunnerSession
} from '@mobi/daemon/runner/controlClient'
import { getLatestRunnerLog } from '@mobi/node-core/logger'
import type { CommandDefinition } from './types'

function showRunnerHelp(): void {
    console.log(`
${chalk.bold('mobi runner')} - Manage runner sessions

${chalk.bold('Usage:')}
  mobi runner list                 List active sessions
  mobi runner logs                 Show latest log file path
  mobi runner stop-session <id>    Stop a specific session

${chalk.gray('Runner runs inside the mobi daemon — start/stop it with')} ${chalk.cyan('mobi daemon')}
${chalk.gray('Clean up all mobi processes:')} ${chalk.cyan('mobi doctor clean')}
`)
}

export const runnerCommand: CommandDefinition = {
    name: 'runner',
    requiresRuntimeAssets: true,
    run: async ({ commandArgs }) => {
        const runnerSubcommand = commandArgs[0]

        if (runnerSubcommand === '-h' || runnerSubcommand === '--help') {
            showRunnerHelp()
            return
        }

        if (runnerSubcommand === 'list') {
            try {
                const sessions = await listRunnerSessions()

                if (sessions.length === 0) {
                    console.log('No active sessions this runner is aware of (they might have been started by a previous version of the daemon)')
                } else {
                    console.log('Active sessions:')
                    console.log(JSON.stringify(sessions, null, 2))
                }
            } catch {
                console.log('No daemon running')
            }
            return
        }

        if (runnerSubcommand === 'stop-session') {
            const sessionId = commandArgs[1]
            if (!sessionId) {
                console.error('Session ID required')
                process.exit(1)
            }

            try {
                const success = await stopRunnerSession(sessionId)
                console.log(success ? 'Session stopped' : 'Failed to stop session')
            } catch {
                console.log('No daemon running')
            }
            return
        }

        if (runnerSubcommand === 'logs') {
            const latest = await getLatestRunnerLog()
            if (!latest) {
                console.log('No runner logs found')
            } else {
                console.log(latest.path)
            }
            process.exit(0)
        }

        showRunnerHelp()
    },
}
