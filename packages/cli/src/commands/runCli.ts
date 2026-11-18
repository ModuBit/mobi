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

import packageJson from '../../package.json'
import chalk from 'chalk'
import { ensureRuntimeAssets } from '@/runtime/assets'
import { isBunCompiled } from '@mobi/node-core/projectPath'
import { logger } from '@mobi/node-core/logger'
import { getCliArgs } from '@mobi/node-core/utils/cliArgs'
import { loadProfile } from '@mobi/shared/profile'
import { resolveCommand } from './registry'

export async function runCli(): Promise<void> {
    const args = getCliArgs()

    // 加载 profile（会从 args 中移除 --profile 参数）
    const profile = loadProfile(args)
    if (profile) {
        logger.debug(`[PROFILE] 已加载 profile: ${profile}`)
    }

    // cli 侧旧单文件 settings.json 的一次性迁移（profile 的 MOBI_HOME 已就位）。
    // 须先于 configuration 首次读 settings：远程部署形态下 daemon 的迁移够不到 cli 机器
    const { migrateLegacyCliSettings } = await import('@mobi/node-core/persistence')
    await migrateLegacyCliSettings()

    if (args.includes('-v') || args.includes('--version')) {
        console.log(`mobi version: ${packageJson.version}`)
        process.exit(0)
    }

    if (isBunCompiled()) {
        process.env.DEV = 'false'
    }

    const resolution = resolveCommand(args)

    // 未知命令明确报错（发现 B）：不再兜底给 `mobi claude` 内部入口——
    // typo 静默抵达会拉起 daemon 并隐式创建托管会话
    if (resolution.kind === 'unknown') {
        console.error(chalk.red(`Unknown command: ${resolution.word}`))
        if (resolution.suggestions.length > 0) {
            console.error(chalk.gray(`  Did you mean: mobi ${resolution.suggestions.join(', ')}?`))
        }
        console.error(chalk.gray('  Run mobi --help for available commands'))
        process.exit(1)
    }

    const { command, context } = resolution

    if (command.requiresRuntimeAssets) {
        await ensureRuntimeAssets()
        logger.debug('Starting mobi CLI with args: ', process.argv)
    }

    await command.run(context)
}
