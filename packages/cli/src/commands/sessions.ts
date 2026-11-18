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
import { planStop } from './stopPlan'
import type { CommandDefinition } from './types'

function showSessionsHelp(): void {
    console.log(`
${chalk.bold('mobi sessions')} - Manage daemon sessions

${chalk.bold('Usage:')}
  mobi sessions list [--json]  List hosted sessions (--json for machine-readable output)
  mobi sessions stop <id>      Stop a specific session

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
            // --json = 机器可读通道：旧版进程列表的脚本消费契约（JSON.stringify），
            // 换 SQLite 只读投影后人类可读文本成为默认档，脚本解析端经此 flag 恢复
            const asJson = commandArgs.slice(1).includes('--json')
            try {
                const sessions = listForkableSessions(
                    resolveMobiDbPath(),
                    await resolveCliNamespace()
                )

                if (asJson) {
                    // 空清单输出 []（脚本据此区分「空」与「失败」）；行含 nativeSessionId
                    // 为 null 的未就绪行，由脚本侧自行过滤
                    console.log(JSON.stringify(sessions, null, 2))
                    return
                }

                if (sessions.length === 0) {
                    console.log('没有可列出的托管会话（活跃或休眠）')
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
            const query = commandArgs[1]
            if (!query) {
                console.error('Session ID required')
                process.exit(1)
            }

            try {
                // 列表展示的是 8 位短 id（含 dormant 行），executor 追踪表按完整 mobi id
                // 全等匹配——用户输入必须先经 planStop 折算（与 fork 同一套匹配语义），
                // 否则照列表抄的短 id 必然落空（发现 C）
                const sessions = listForkableSessions(resolveMobiDbPath(), await resolveCliNamespace())
                const plan = planStop(sessions, query)

                if (plan.kind === 'empty' || plan.kind === 'not-found') {
                    console.error(chalk.red(`未找到会话：${plan.kind === 'empty' ? query : plan.query}`))
                    console.error(chalk.gray('  运行 mobi sessions list 查看可操作会话（列表展示 8 位短 id）'))
                    process.exitCode = 1
                    return
                }

                if (plan.kind === 'ambiguous') {
                    console.error(chalk.red('匹配到多个会话，请用更精确的 id 指定：'))
                    plan.matches.forEach((session, index) => console.log(formatSessionLine(session, index)))
                    process.exitCode = 1
                    return
                }

                if (plan.kind === 'dormant') {
                    console.log('该会话处于休眠，无进程可停止')
                    return
                }

                const success = await stopExecutorSession(plan.session.id)
                if (success) {
                    console.log('Session stopped')
                } else {
                    console.error(chalk.red('Failed to stop session'))
                    process.exitCode = 1
                }
            } catch (error) {
                if (error instanceof SessionListingError) {
                    console.error(chalk.red(error.message))
                } else {
                    console.log('No daemon running')
                }
                process.exitCode = 1
            }
            return
        }

        showSessionsHelp()
    },
}
