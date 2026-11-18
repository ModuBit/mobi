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
 * 命令词路由决策（tui-fork 收敛遗留，发现 B）。
 *
 * 与 registry 分离的原因同 forkPlan：registry 聚合全部命令实现（传递依赖含
 * bun:sqlite），vitest/node 单测加载不动；路由规则必须能在不碰命令实现的前提下
 * 被锁定。收敛后 CLI 不再隐式创建会话（defaultHelp 明文承诺），未知词曾兜底给
 * `mobi claude` 内部入口——typo（forkk / seesions）会 initializeToken + 拉起
 * daemon + 隐式建托管会话；现在未知词明确报错。
 */

/** daemon executor spawn 的内部入口词（buildClaudeSpawnArgs 恒以其开头） */
const INTERNAL_ENTRY_WORD = 'claude'

export type CommandRoute =
    | { kind: 'default'; commandArgs: string[] }
    | { kind: 'known'; name: string; commandArgs: string[] }
    | { kind: 'claude'; commandArgs: string[] }
    | { kind: 'unknown'; word: string; suggestions: string[] }

/**
 * 近似命令提示：共享前 ≥2 字符前缀即视为相近（forkk→fork、seesions→sessions）。
 * 前缀不足 2 字符不给提示，避免单字母命中的噪音；'claude' 是内部入口不进名单。
 */
export function suggestCommands(word: string, knownNames: readonly string[]): string[] {
    const prefix = word.toLowerCase().slice(0, 2)
    if (prefix.length < 2) return []
    return knownNames.filter(name => name.startsWith(prefix))
}

/**
 * 首个参数的路由分类：
 * - 无参或 flag 开头（如 `mobi --help`）→ default：由 claude 命令打印帮助，
 *   旧肌肉记忆的带参 flag（如 --continue）也落在此类，由其守卫拒绝
 * - 已知子命令 → known
 * - 显式 'claude' 词 → claude：daemon spawn 的内部入口，不出现在帮助里
 * - 其余未知词 → unknown：明确报错，绝不兜底给内部入口
 */
export function routeCommand(args: string[], knownNames: readonly string[]): CommandRoute {
    const subcommand = args[0]

    if (!subcommand || subcommand.startsWith('-')) {
        return { kind: 'default', commandArgs: args }
    }

    if (knownNames.includes(subcommand)) {
        return { kind: 'known', name: subcommand, commandArgs: args.slice(1) }
    }

    if (subcommand === INTERNAL_ENTRY_WORD) {
        return { kind: 'claude', commandArgs: args.slice(1) }
    }

    return { kind: 'unknown', word: subcommand, suggestions: suggestCommands(subcommand, knownNames) }
}
