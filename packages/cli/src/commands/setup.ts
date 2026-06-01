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
import { runSettingsWizard } from '@/setup/settingsWizard'
import { installService, removeService, serviceStatus } from '@/setup/serviceManager'
import { askChoice } from '@/setup/prompts'
import type { CommandContext, CommandDefinition } from './types'

function showSetupHelp(): void {
    console.log(`
${chalk.bold('mobi setup')} - Interactive setup wizard (first-time)

${chalk.bold('Usage:')}
  mobi setup                 Interactive setup wizard
  mobi setup settings        Configure settings.json
  mobi setup service install Install and start system service
  mobi setup service remove  Remove system service
  mobi setup service status  Show service status
`)
}

export const setupCommand: CommandDefinition = {
    name: 'setup',
    requiresRuntimeAssets: true,
    run: async (context: CommandContext) => {
        const subcommand = context.commandArgs[0]

        if (subcommand === '-h' || subcommand === '--help') {
            showSetupHelp()
            return
        }

        if (subcommand === 'settings') {
            await runSettingsWizard()
            return
        }

        if (subcommand === 'service') {
            const serviceAction = context.commandArgs[1]

            if (serviceAction === 'install') {
                // 确保 settings 已配置
                const settings = await runSettingsWizard()
                await installService(settings.listenHost, settings.listenPort)
                return
            }

            if (serviceAction === 'remove') {
                await removeService()
                return
            }

            if (serviceAction === 'status') {
                await serviceStatus()
                return
            }

            showSetupHelp()
            return
        }

        // 默认：完整 wizard
        // 1. 配置 settings
        console.log(chalk.bold('Mobi Setup Wizard'))
        console.log('')
        const settings = await runSettingsWizard()

        // 2. 询问启动方式
        console.log('')
        const choice = await askChoice(
            'How would you like to start mobi?',
            [
                { label: 'Start now (background, won\'t survive reboot)', value: 'now' },
                { label: 'Install as system service (auto-start on boot)', value: 'service' },
                { label: 'Start manually later', value: 'skip' },
            ]
        )

        if (choice === 'now') {
            const { execFileSync } = await import('node:child_process')
            const { getMobiCliCommand } = await import('@/utils/spawnMobiCli')

            const serviceArgs = ['service', 'start', '--host', settings.listenHost, '--port', String(settings.listenPort)]
            const cmd = getMobiCliCommand(serviceArgs)
            try {
                execFileSync(cmd.command, cmd.args, { stdio: 'inherit', timeout: 30_000 })
                console.log('')
                console.log(chalk.green('Mobi is ready!'))
                console.log(chalk.cyan(`  Web: http://localhost:${settings.listenPort}`))
            } catch {
                console.log(chalk.yellow('Service start failed'))
            }
        } else if (choice === 'service') {
            await installService(settings.listenHost, settings.listenPort)
            console.log('')
            console.log(chalk.green('Mobi is ready!'))
            console.log(chalk.cyan(`  Web: http://localhost:${settings.listenPort}`))
        } else {
            console.log('')
            console.log(chalk.gray('Start manually:'))
            console.log(chalk.gray('  mobi hub start'))
            console.log(chalk.gray('  mobi runner start'))
        }
    }
}
