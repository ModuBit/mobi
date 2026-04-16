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

import type { CommandDefinition } from './types'

/**
 * hook-forwarder 命令
 * 用于转发 Claude 的 SessionStart hook 到主 CLI 进程
 * 这是一个内部命令，不应该触发完整的 CLI 启动流程
 */
export const hookForwarderCommand: CommandDefinition = {
    name: 'hook-forwarder',
    requiresRuntimeAssets: false,
    run: async ({ commandArgs }) => {
        const { runSessionHookForwarder } = await import('@/claude/utils/sessionHookForwarder')
        await runSessionHookForwarder(commandArgs)
    }
}
