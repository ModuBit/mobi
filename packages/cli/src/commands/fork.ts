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
 * `mobi fork` 命令（tui-fork 票 01/02）：把托管会话的上下文复制到终端。
 *
 * 与 local 模式的本质区别：fork 产物是 Claude Code 自己分配的新会话，
 * 不落 mobi 库、不上报 daemon、不注入 mobi 能力；原 Web 会话完全不受影响。
 * 数据源是 daemon 的 SQLite 账本（只读），因此 daemon 停机时同样可用。
 */

import chalk from 'chalk'
import { spawn } from 'node:child_process'
import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { resolveMobiDbPath } from '@mobi/node-core/dbPath'
import { getClaudeExecutablePath } from '@mobi/node-core/claudeSdk/claudeExecutable'
import { childEnvWithoutDebugger } from '@mobi/node-core/utils/spawnMobiCli'
import { withBunRuntimeEnv } from '@mobi/node-core/utils/bunRuntime'
import type { ForkableSession } from '@mobi/shared'
import { listForkableSessions, SessionListingError } from '@mobi/daemon/store/sessionListing'
import { buildForkSpawnArgs, filterSessions, formatSessionLine, planFork } from './forkPlan'
import { resolveCliNamespace } from './namespace'
import type { CommandDefinition } from './types'

function showForkHelp(): void {
    console.log(`
${chalk.bold('mobi fork')} - Fork a hosted session into a local Claude TUI

${chalk.bold('Usage:')}
  mobi fork                  Pick from recent hosted sessions
  mobi fork <id|title>       Fork the matching session directly

${chalk.gray('The fork gets a new Claude session id and is not tracked by mobi.')}
${chalk.gray('The original Web session keeps running untouched.')}
`)
}

function isYes(answer: string): boolean {
    const lowered = answer.trim().toLowerCase()
    return lowered === 'y' || lowered === 'yes'
}

function printSessions(sessions: readonly ForkableSession[]): void {
    for (let i = 0; i < sessions.length; i += 1) {
        console.log(formatSessionLine(sessions[i], i))
    }
    console.log('')
}

/** 在线会话的 fork 风险提示（交互确认与一次性警告共用同一文案） */
const ONLINE_FORK_WARNING = '该会话进程仍在线；若正在执行 turn，最近一轮可能尚未写入 transcript'

/**
 * 交互选择：默认最近活跃（回车）；输入序号选中；输入非数字则按关键字过滤候选。
 * 选中进程在线的会话时要求二次确认（当前轮可能尚未写入 transcript）。
 */
async function promptForSession(initial: readonly ForkableSession[]): Promise<ForkableSession> {
    let candidates = [...initial]
    const rl = readline.createInterface({ input, output })

    try {
        while (true) {
            printSessions(candidates)
            const answer = (
                await rl.question(
                    `选择序号 [1-${candidates.length}]、输入关键字过滤，或回车选最近: `
                )
            ).trim()

            let chosen: ForkableSession
            if (!answer) {
                chosen = candidates[0]
            } else if (/^\d+$/.test(answer)) {
                const index = Number.parseInt(answer, 10)
                if (index < 1 || index > candidates.length) {
                    console.error(chalk.red(`无效序号：${answer}`))
                    continue
                }
                chosen = candidates[index - 1]
            } else {
                const filtered = filterSessions(initial, answer)
                if (filtered.length === 0) {
                    console.error(chalk.red(`没有匹配「${answer}」的会话`))
                    continue
                }
                candidates = filtered
                continue
            }

            if (chosen.status === 'online') {
                const confirmed = await rl.question(
                    chalk.yellow(`${ONLINE_FORK_WARNING}。继续 fork？(y/N): `)
                )
                if (!isYes(confirmed)) continue
            }

            return chosen
        }
    } finally {
        rl.close()
    }
}

/**
 * 非交互环境给出可操作提示并返回 null；否则进入交互选择器。
 */
async function pickSession(
    candidates: readonly ForkableSession[],
    nonTtyMessage: string,
    nonTtyHint?: string
): Promise<ForkableSession | null> {
    if (!process.stdin.isTTY) {
        console.error(chalk.red(nonTtyMessage))
        if (nonTtyHint) console.error(chalk.gray(`  ${nonTtyHint}`))
        process.exitCode = 1
        return null
    }
    return promptForSession(candidates)
}

/** 在会话工作目录启动 Claude；stdio 继承，用户看到原生 TUI */
async function launchFork(session: ForkableSession): Promise<void> {
    const args = buildForkSpawnArgs(session.nativeSessionId)
    const claudeCommand = (await getClaudeExecutablePath()) ?? 'claude'

    console.log(chalk.gray(`→ ${claudeCommand} ${args.join(' ')}`))
    console.log(chalk.gray(`  cwd: ${session.path}\n`))

    const child = spawn(claudeCommand, args, {
        cwd: session.path,
        stdio: 'inherit',
        env: childEnvWithoutDebugger(withBunRuntimeEnv()),
        shell: false
    })

    await new Promise<void>((resolve, reject) => {
        child.on('close', code => {
            if (code === 0) resolve()
            else reject(new Error(`Claude exited with code ${code}`))
        })
        child.on('error', reject)
    })
}

export const forkCommand: CommandDefinition = {
    name: 'fork',
    requiresRuntimeAssets: false,
    run: async ({ commandArgs }) => {
        if (commandArgs.includes('-h') || commandArgs.includes('--help')) {
            showForkHelp()
            return
        }

        const query = commandArgs.find(arg => !arg.startsWith('-'))

        try {
            const namespace = await resolveCliNamespace()
            const sessions = listForkableSessions(resolveMobiDbPath(), namespace)
            const plan = planFork(sessions, query)

            if (plan.kind === 'empty') {
                console.log('没有可 fork 的会话（需要活跃或休眠、且已产生 Claude 会话的会话）')
                process.exitCode = 1
                return
            }

            if (plan.kind === 'not-found') {
                console.error(chalk.red(`未找到会话：${plan.query}`))
                if (plan.nativeIdLike) {
                    console.error(
                        chalk.gray('  这看起来是 Claude 原生 session id；fork 需要 mobi 会话 id 或标题（后者才能定位工作目录）')
                    )
                } else {
                    console.error(chalk.gray('  运行 mobi fork 查看可选会话，或按标题 / mobi 会话 id 指定'))
                }
                process.exitCode = 1
                return
            }

            let session: ForkableSession

            if (!query) {
                const chosen = await pickSession(
                    sessions,
                    '非交互环境无法选择会话',
                    '请用 mobi fork <id|title> 指定目标'
                )
                if (!chosen) return
                session = chosen
            } else if (plan.kind === 'resolved') {
                session = plan.session
                if (session.status === 'online') {
                    console.warn(chalk.yellow(`⚠ ${ONLINE_FORK_WARNING}`))
                }
            } else {
                const chosen = await pickSession(
                    plan.matches,
                    '匹配到多个会话，请用更精确的 id 或标题指定'
                )
                if (!chosen) return
                session = chosen
            }

            await launchFork(session)
        } catch (error) {
            if (error instanceof SessionListingError) {
                console.error(chalk.red(error.message))
            } else {
                console.error(chalk.red('fork 失败：'), error instanceof Error ? error.message : String(error))
            }
            process.exitCode = 1
        }
    }
}
