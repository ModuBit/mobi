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

import { authCommand } from './auth'
import { claudeCommand } from './claude'
import { runnerCommand } from './runner'
import { doctorCommand } from './doctor'
import { mcpCommand } from './mcp'
import { hubCommand } from './hub'
import { serviceCommand } from './service'
import { hookForwarderCommand } from './hookForwarder'
import { versionCommand } from './version'
import { upgradeCommand } from './upgrade'
import { setupCommand } from './setup'
import type { CommandContext, CommandDefinition } from './types'

// Mobi 只支持 Claude Code，移除了 codex, cursor, gemini, opencode 等多 Agent 命令
const COMMANDS: CommandDefinition[] = [
    authCommand,
    mcpCommand,
    hubCommand,
    serviceCommand,
    doctorCommand,
    runnerCommand,
    versionCommand,
    upgradeCommand,
    setupCommand,
    hookForwarderCommand // 用于转发 Claude 的 SessionStart hook
]

const commandMap = new Map<string, CommandDefinition>()
for (const command of COMMANDS) {
    commandMap.set(command.name, command)
}

export function resolveCommand(args: string[]): { command: CommandDefinition; context: CommandContext } {
    const subcommand = args[0]
    const command = subcommand ? commandMap.get(subcommand) : undefined
    const resolvedCommand = command ?? claudeCommand
    const commandArgs = command ? args.slice(1) : args

    return {
        command: resolvedCommand,
        context: {
            args,
            subcommand,
            commandArgs
        }
    }
}
