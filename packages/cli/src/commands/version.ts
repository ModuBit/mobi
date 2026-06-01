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
import packageJson from '../../package.json'
import { fetchReleases } from '@/upgrader/checker'
import { readSettings } from '@/persistence'
import type { Channel } from '@/upgrader/constants'
import type { CommandDefinition, CommandContext } from './types'

function showCurrentVersion(): void {
    console.log(`v${packageJson.version}`)
}

async function showVersionList(channel?: Channel, showAll?: boolean): Promise<void> {
    try {
        if (showAll) {
            const [stableReleases, rcReleases] = await Promise.all([
                fetchReleases({ channel: 'stable' }),
                fetchReleases({ channel: 'rc' }),
            ])

            if (stableReleases.length > 0) {
                console.log('stable:')
                for (const r of stableReleases) {
                    const date = new Date(r.published_at).toISOString().split('T')[0]
                    console.log(`  ${r.tag_name}  (${date})`)
                }
            }

            if (rcReleases.length > 0) {
                if (stableReleases.length > 0) console.log('')
                console.log('rc:')
                for (const r of rcReleases) {
                    const date = new Date(r.published_at).toISOString().split('T')[0]
                    console.log(`  ${r.tag_name}  (${date})`)
                }
            }
        } else {
            const releases = await fetchReleases({ channel })
            for (const r of releases) {
                const date = new Date(r.published_at).toISOString().split('T')[0]
                console.log(`${r.tag_name}  (${date})`)
            }
        }

        const settings = await readSettings()
        const currentChannel = settings.updateChannel ?? 'stable'
        console.log('')
        console.log(`current: v${packageJson.version} (${currentChannel})`)
    } catch (error) {
        console.error(chalk.red('Failed to fetch versions:'), error instanceof Error ? error.message : String(error))
        process.exit(1)
    }
}

export const versionCommand: CommandDefinition = {
    name: 'version',
    requiresRuntimeAssets: false,
    run: async (context: CommandContext) => {
        const subcommand = context.commandArgs[0]

        if (subcommand === '-h' || subcommand === '--help') {
            console.log(`
${chalk.bold('mobi version')} - Show version info

${chalk.bold('Usage:')}
  mobi version              Show current version
  mobi version list         List available versions
  mobi version list --all   List stable + rc versions
  mobi version list rc      List rc versions only
`)
            return
        }

        if (subcommand === 'list') {
            const filter = context.commandArgs[1]
            const showAll = filter === '--all'

            let channel: Channel | undefined
            if (filter === 'rc') channel = 'rc'
            else if (filter === 'stable') channel = 'stable'

            await showVersionList(channel, showAll)
            return
        }

        showCurrentVersion()
    }
}
