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
 * 命令词路由决策契约（tui-fork 收敛遗留，发现 B）。
 * registry 兜底曾让任意 typo 静默抵达 `mobi claude` 内部入口（隐式拉起 daemon、
 * 创建托管会话）；收敛后未知词必须明确报错。纯函数锁定，不触碰命令实现。
 */

import { describe, expect, it } from 'vitest'
import { routeCommand, suggestCommands } from '@/commands/commandRoute'

// 与 registry 的 COMMANDS 名单同构的测试替身
const KNOWN = ['auth', 'mcp', 'daemon', 'service', 'logs', 'doctor', 'sessions', 'fork', 'version', 'upgrade', 'setup']

describe('routeCommand', () => {
    it('无参 → default（claude 命令打印帮助）', () => {
        expect(routeCommand([], KNOWN)).toEqual({ kind: 'default', commandArgs: [] })
    })

    it('flag 开头（mobi --help）→ default，flag 保留在 commandArgs', () => {
        expect(routeCommand(['--help'], KNOWN)).toEqual({ kind: 'default', commandArgs: ['--help'] })
    })

    it('已知子命令 → known，commandArgs 剥掉命令词', () => {
        expect(routeCommand(['fork', 'abc'], KNOWN)).toEqual({
            kind: 'known',
            name: 'fork',
            commandArgs: ['abc']
        })
    })

    it('显式 claude 词 → claude（daemon spawn 的内部入口，commandArgs 剥掉）', () => {
        expect(routeCommand(['claude', '--resume', 'x', '--started-by', 'daemon'], KNOWN)).toEqual({
            kind: 'claude',
            commandArgs: ['--resume', 'x', '--started-by', 'daemon']
        })
    })

    it('typo（forkk）→ unknown 且附相近命令提示，不再兜底给内部入口', () => {
        const route = routeCommand(['forkk'], KNOWN)
        expect(route.kind).toBe('unknown')
        if (route.kind === 'unknown') expect(route.suggestions).toContain('fork')
    })

    it('typo（seesions list）→ unknown', () => {
        const route = routeCommand(['seesions', 'list'], KNOWN)
        expect(route.kind).toBe('unknown')
        if (route.kind === 'unknown') expect(route.suggestions).toContain('sessions')
    })

    it('完全不相干的词 → unknown 且无提示', () => {
        expect(routeCommand(['zzz'], KNOWN)).toEqual({ kind: 'unknown', word: 'zzz', suggestions: [] })
    })

    it('旧肌肉记忆 mobi --continue → default（由 claude 命令的守卫拒绝，非 unknown）', () => {
        expect(routeCommand(['--continue'], KNOWN)).toEqual({
            kind: 'default',
            commandArgs: ['--continue']
        })
    })
})

describe('suggestCommands', () => {
    it('共享前 ≥2 字符前缀即视为相近（前缀可能命中多个，全量返回）', () => {
        expect(suggestCommands('forkk', KNOWN)).toEqual(['fork'])
        expect(suggestCommands('seesions', KNOWN)).toContain('sessions')
    })

    it('前缀不足 2 字符不给提示，避免噪音', () => {
        expect(suggestCommands('f', KNOWN)).toEqual([])
    })
})
