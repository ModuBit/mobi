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
import { ensureRuntimeAssets } from '@/runtime/assets'
import { isBunCompiled } from '@/projectPath'
import { logger } from '@/ui/logger'
import { getCliArgs } from '@/utils/cliArgs'
import { loadProfile } from '@mobi/shared/profile'
import { resolveCommand } from './registry'

export async function runCli(): Promise<void> {
    const args = getCliArgs()

    // 加载 profile（会从 args 中移除 --profile 参数）
    const profile = loadProfile(args)
    if (profile) {
        logger.debug(`[PROFILE] 已加载 profile: ${profile}`)
    }

    if (args.includes('-v') || args.includes('--version')) {
        console.log(`mobi version: ${packageJson.version}`)
        process.exit(0)
    }

    if (isBunCompiled()) {
        process.env.DEV = 'false'
    }

    const { command, context } = resolveCommand(args)

    if (command.requiresRuntimeAssets) {
        await ensureRuntimeAssets()
        logger.debug('Starting mobi CLI with args: ', process.argv)
    }

    await command.run(context)
}
