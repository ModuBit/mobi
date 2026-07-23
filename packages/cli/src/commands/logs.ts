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
import { findLatestLog, type LogProcessType } from '@mobi/shared/logger'
import { configuration } from '@/configuration'
import type { CommandDefinition, CommandContext } from './types'

const TYPES: LogProcessType[] = ['hub', 'runner', 'cli']

function showHelp(): void {
    console.log(`
${chalk.bold('mobi logs')} - 打印各进程最新日志文件路径

${chalk.bold('Usage:')}
  mobi logs            打印 hub / runner / cli 各自最新路径
  mobi logs hub        打印最新 hub 日志路径
  mobi logs runner     打印最新 runner 日志路径
  mobi logs cli        打印最新 cli 日志路径
  mobi logs all        等同 mobi logs

${chalk.gray('日志目录:')} ${configuration.logsDir}
`)
}

function printOne(type: LogProcessType): void {
    const path = findLatestLog(configuration.logsDir, type)
    if (path) {
        console.log(`${chalk.cyan(type.padEnd(7))} ${path}`)
    } else {
        console.log(`${chalk.gray(type.padEnd(7))} (无日志)  ${configuration.logsDir}`)
    }
}

export const logsCommand: CommandDefinition = {
    name: 'logs',
    requiresRuntimeAssets: false,
    run: async (context: CommandContext) => {
        const sub = context.commandArgs[0]

        if (sub === '-h' || sub === '--help') {
            showHelp()
            return
        }

        if (sub === undefined || sub === 'all') {
            console.log(chalk.gray(`日志目录: ${configuration.logsDir}`))
            for (const t of TYPES) printOne(t)
            return
        }

        if ((TYPES as string[]).includes(sub)) {
            printOne(sub as LogProcessType)
            return
        }

        console.log(chalk.red(`未知进程类型: ${sub}`))
        showHelp()
    },
}
