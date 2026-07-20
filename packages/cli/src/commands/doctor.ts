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
import { killRunawayMobiProcesses } from '@/runner/doctor'
import { runDoctorCommand } from '@/ui/doctor'
import { printExitReport } from '@/ui/exitLogReport'
import type { ProcessType } from '@mobi/shared/exitLogger'
import type { CommandDefinition } from './types'

export const doctorCommand: CommandDefinition = {
    name: 'doctor',
    requiresRuntimeAssets: true,
    run: async ({ commandArgs }) => {
        if (commandArgs[0] === '-h' || commandArgs[0] === '--help') {
            console.log(`
${chalk.bold('mobi doctor')} - System diagnostics & troubleshooting

${chalk.bold('Usage:')}
  mobi doctor                 Run diagnostics
  mobi doctor hub             Diagnose hub issues
  mobi doctor runner          Diagnose runner issues
  mobi doctor clean           Clean up all runaway processes
  mobi doctor clean [profile] Clean up processes for a specific profile
  mobi doctor exits           Show recent process exit records
  mobi doctor exits --process hub|runner|cli
  mobi doctor exits --limit N
`)
            return
        }

        if (commandArgs[0] === 'clean') {
            // mobi doctor clean [profile]
            // mobi doctor clean        → 清理全部
            // mobi doctor clean e2e    → 只清理 e2e profile
            const profile = commandArgs[1]

            if (profile) {
                console.log(`Cleaning up runaway processes for profile: ${chalk.cyan(profile)}`)
            } else {
                console.log('Cleaning up all mobi processes (hub, runner, sessions)')
            }

            const result = await killRunawayMobiProcesses(profile)
            console.log(`Cleaned up ${result.killed} runaway processes`)
            if (result.errors.length > 0) {
                console.log('Errors:', result.errors)
            }
            process.exit(0)
        }

        if (commandArgs[0] === 'exits') {
            // mobi doctor exits [--process hub|runner|cli] [--limit N]
            const processIdx = commandArgs.indexOf('--process')
            const processFilter = processIdx >= 0 ? commandArgs[processIdx + 1] as ProcessType : undefined
            const limitIdx = commandArgs.indexOf('--limit')
            const rawLimit = limitIdx >= 0 ? Number(commandArgs[limitIdx + 1]) : undefined
            // NaN/缺值回退到默认 20（printExitReport 内 ?? 20）
            const limit = rawLimit !== undefined && Number.isFinite(rawLimit) ? rawLimit : undefined
            printExitReport({ limit, processFilter })
            return
        }

        await runDoctorCommand(commandArgs[0])
    }
}
