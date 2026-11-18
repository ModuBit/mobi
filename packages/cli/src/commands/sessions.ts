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
 * `mobi sessions` 命令：会话管理工具族（list / stop）。
 *
 * 原 `mobi runner` 命令面去 runner 词汇（remove-machine 601）：runner 概念随单机
 * daemon 收敛退场，会话管理能力原样承接于此；日志查看走 `mobi logs`，
 * 进程级操作走 `mobi daemon` / `mobi service`。
 */

import chalk from 'chalk'
import { stopExecutorSession } from '@mobi/daemon/executor/controlClient'
import { listForkableSessions, SessionListingError } from '@mobi/daemon/store/sessionListing'
import { resolveMobiDbPath } from '@mobi/node-core/dbPath'
import { formatSessionLine } from './forkPlan'
import { resolveCliNamespace } from './namespace'
import type { CommandDefinition } from './types'

function showSessionsHelp(): void {
    console.log(`
${chalk.bold('mobi sessions')} - Manage daemon sessions

${chalk.bold('Usage:')}
  mobi sessions list         List hosted sessions
  mobi sessions stop <id>    Stop a specific session

${chalk.gray('Sessions run inside the mobi daemon — manage it with')} ${chalk.cyan('mobi daemon')}
${chalk.gray('Clean up all mobi processes:')} ${chalk.cyan('mobi doctor clean')}
`)
}

export const sessionsCommand: CommandDefinition = {
    name: 'sessions',
    requiresRuntimeAssets: true,
    run: async ({ commandArgs }) => {
        const subcommand = commandArgs[0]

        if (subcommand === '-h' || subcommand === '--help') {
            showSessionsHelp()
            return
        }

        if (subcommand === 'list') {
            try {
                const sessions = listForkableSessions(
                    resolveMobiDbPath(),
                    await resolveCliNamespace()
                )

                if (sessions.length === 0) {
                    console.log('没有可列出的托管会话（活跃或休眠、且已产生 Claude 会话）')
                } else {
                    console.log('托管会话（最近活跃优先）：\n')
                    sessions.forEach((session, index) => {
                        console.log(formatSessionLine(session, index))
                    })
                    console.log('\n在终端接续：mobi fork')
                }
            } catch (error) {
                if (error instanceof SessionListingError) {
                    console.error(chalk.red(error.message))
                } else {
                    // 读取/编程错误不能伪装成「daemon 没启动」：如实透出并置失败码
                    console.error(chalk.red('读取会话失败：'), error instanceof Error ? error.message : String(error))
                }
                process.exitCode = 1
            }
            return
        }

        if (subcommand === 'stop') {
            const sessionId = commandArgs[1]
            if (!sessionId) {
                console.error('Session ID required')
                process.exit(1)
            }

            try {
                const success = await stopExecutorSession(sessionId)
                console.log(success ? 'Session stopped' : 'Failed to stop session')
            } catch {
                console.log('No daemon running')
            }
            return
        }

        showSessionsHelp()
    },
}
