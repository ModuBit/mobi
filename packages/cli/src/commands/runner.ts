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
    checkIfRunnerRunningAndCleanupStaleState,
    listRunnerSessions,
    stopRunner,
    stopRunnerSession
} from '@/runner/controlClient'
import { getLatestRunnerLog } from '@/ui/logger'
import { spawnMobiCli } from '@/utils/spawnMobiCli'
import { isProcessAlive } from '@/utils/process'
import { readRunnerState } from '@/persistence'
import { initializeToken } from '@/ui/tokenInit'
import type { CommandDefinition } from './types'

function showRunnerHelp(): void {
    console.log(`
${chalk.bold('mobi runner')} - Manage background runner

${chalk.bold('Usage:')}
  mobi runner start                Start runner in background
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
            const child = spawnMobiCli(['runner', 'start-sync'], {
                detached: true,
                stdio: 'ignore',
                env: process.env
            })
            child.unref()

            let started = false
            for (let i = 0; i < 50; i++) {
                if (await checkIfRunnerRunningAndCleanupStaleState()) {
                    started = true
                    break
                }
                await new Promise(resolve => setTimeout(resolve, 100))
            }

            if (started) {
                console.log(chalk.green(`Runner started (PID ${child.pid})`))
            } else {
                console.error(chalk.red('Failed to start runner'))
                process.exit(1)
            }
            process.exit(0)
        }

        if (runnerSubcommand === 'start-sync') {
            await initializeToken()
            await startRunner()
            process.exit(0)
        }

        if (runnerSubcommand === 'stop') {
            const state = await readRunnerState()
            if (!state) {
                console.log(chalk.yellow('Runner is not running'))
                process.exit(0)
            }
            if (!isProcessAlive(state.pid)) {
                console.log(chalk.yellow('Runner is not running'))
                console.log(chalk.gray(`  Process (PID ${state.pid}) is dead`))
                process.exit(0)
            }

            console.log(`Stopping runner (PID ${state.pid})...`)
            try {
                await stopRunner()
                console.log(chalk.green('Runner stopped'))
            } catch {
                console.error(chalk.red('Failed to stop runner'))
                process.exit(1)
            }
            process.exit(0)
        }

        if (runnerSubcommand === 'restart') {
            // stop
            const state = await readRunnerState()
            if (state && isProcessAlive(state.pid)) {
                console.log(`Stopping runner (PID ${state.pid})...`)
                try {
                    await stopRunner()
                    console.log(chalk.green('Runner stopped'))
                } catch {
                    console.error(chalk.red('Cannot restart: failed to stop runner'))
                    process.exit(1)
                }
            }

            // start
            const child = spawnMobiCli(['runner', 'start-sync'], {
                detached: true,
                stdio: 'ignore',
                env: process.env
            })
            child.unref()

            let started = false
            for (let i = 0; i < 50; i++) {
                if (await checkIfRunnerRunningAndCleanupStaleState()) {
                    started = true
                    break
                }
                await new Promise(resolve => setTimeout(resolve, 100))
            }

            if (started) {
                console.log(chalk.green('Runner restarted successfully'))
            } else {
                console.error(chalk.red('Failed to start runner'))
                process.exit(1)
            }
            process.exit(0)
        }

        if (runnerSubcommand === 'status') {
            const state = await readRunnerState()

            if (!state) {
                console.log(chalk.yellow('Runner is not running'))
                console.log(chalk.gray('  No runner state file found'))
                process.exit(0)
            }

            if (!isProcessAlive(state.pid)) {
                console.log(chalk.yellow('Runner is not running'))
                console.log(chalk.gray(`  Process (PID ${state.pid}) is dead`))
                process.exit(0)
            }

            console.log(chalk.green('Runner is running'))
            console.log(`  PID:       ${state.pid}`)
            console.log(`  Port:      ${state.httpPort}`)
            console.log(`  Started:   ${state.startTime}`)
            if (state.lastHeartbeat) {
                console.log(`  Heartbeat: ${state.lastHeartbeat}`)
            }
            if (state.runnerLogPath) {
                console.log(`  Log:       ${state.runnerLogPath}`)
            }
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
    }
}
