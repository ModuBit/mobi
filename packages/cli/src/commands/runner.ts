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
import { startRunner } from '@/runner/run'
import {
    listRunnerSessions,
    stopRunnerSession
} from '@/runner/controlClient'
import { getLatestRunnerLog } from '@/ui/logger'
import { startPpidWatchdog } from '@/supervisor/ppidWatchdog'
import { initializeToken } from '@/ui/tokenInit'
import { serviceStart, serviceStop, serviceRestart, serviceStatus } from './serviceOps'
import type { CommandDefinition } from './types'

function showRunnerHelp(): void {
    console.log(`
${chalk.bold('mobi runner')} - Manage background runner

${chalk.bold('Usage:')}
  mobi runner start                Start runner (supervised, via mobi service runner start)
  mobi runner stop                 Stop runner (sessions stay alive)
  mobi runner restart              Restart runner
  mobi runner status               Show runner status
  mobi runner list                 List active sessions
  mobi runner logs                 Show latest log file path
  mobi runner stop-session <id>    Stop a specific session

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
                    console.log('No active sessions this runner is aware of (they might have been started by a previous version of the runner)')
                } else {
                    console.log('Active sessions:')
                    console.log(JSON.stringify(sessions, null, 2))
                }
            } catch {
                console.log('No runner running')
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
                console.log('No runner running')
            }
            return
        }

        if (runnerSubcommand === 'start') {
            await serviceStart('runner')
            process.exit(0)
        }

        if (runnerSubcommand === 'start-sync') {
            // 父进程（supervisor，或前台调试时的 shell）死亡时自杀，
            // 避免孤儿 runner 占锁文件/状态文件（SIGTERM 走 runner 既有优雅清理）
            startPpidWatchdog({
                onOrphaned: () => process.kill(process.pid, 'SIGTERM'),
            })
            await initializeToken()
            await startRunner()
            process.exit(0)
        }

        if (runnerSubcommand === 'stop') {
            await serviceStop('runner')
            process.exit(0)
        }

        if (runnerSubcommand === 'restart') {
            await serviceRestart('runner')
            process.exit(0)
        }

        if (runnerSubcommand === 'status') {
            await serviceStatus()
            process.exit(0)
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
