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
import { forkCommand } from './fork'
import { sessionsCommand } from './sessions'
import { doctorCommand } from './doctor'
import { mcpCommand } from './mcp'
import { daemonCommand } from './daemon'
import { serviceCommand } from './service'
import { logsCommand } from './logs'
import { versionCommand } from './version'
import { upgradeCommand } from './upgrade'
import { setupCommand } from './setup'
import { routeCommand } from './commandRoute'
import type { CommandContext, CommandDefinition } from './types'

// Mobi 只支持 Claude Code，移除了 codex, cursor, gemini, opencode 等多 Agent 命令
const COMMANDS: CommandDefinition[] = [
    authCommand,
    mcpCommand,
    daemonCommand,
    serviceCommand,
    logsCommand,
    doctorCommand,
    sessionsCommand,
    forkCommand,
    versionCommand,
    upgradeCommand,
    setupCommand
]

const commandMap = new Map<string, CommandDefinition>()
for (const command of COMMANDS) {
    commandMap.set(command.name, command)
}

export type CommandResolution =
    | { kind: 'resolved'; command: CommandDefinition; context: CommandContext }
    | { kind: 'unknown'; word: string; suggestions: string[] }

/**
 * 命令路由：规则单源在 commandRoute.routeCommand（纯函数，vitest 可锁）。
 * 未知词不再兜底给 claudeCommand——typo（forkk / seesions）此前会静默抵达
 * `mobi claude` 内部入口，触发 initializeToken + 拉起 daemon + 隐式创建托管
 * 会话，违反 defaultHelp 的「不隐式创建会话」承诺；改由 runCli 明确报错。
 */
export function resolveCommand(args: string[]): CommandResolution {
    const route = routeCommand(args, COMMANDS.map(command => command.name))

    if (route.kind === 'unknown') {
        return { kind: 'unknown', word: route.word, suggestions: route.suggestions }
    }

    // known 分支的 name 必在 commandMap（名单由同一 COMMANDS 派生）；缺项属名单漂移，按未知词报错
    if (route.kind === 'known') {
        const known = commandMap.get(route.name)
        if (!known) {
            return { kind: 'unknown', word: route.name, suggestions: [] }
        }
        return {
            kind: 'resolved',
            command: known,
            context: { args, subcommand: args[0], commandArgs: route.commandArgs }
        }
    }

    return {
        kind: 'resolved',
        command: claudeCommand,
        context: { args, subcommand: args[0], commandArgs: route.commandArgs }
    }
}
