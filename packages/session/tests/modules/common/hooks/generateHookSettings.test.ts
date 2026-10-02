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

import { describe, expect, it, afterEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import {
    generateHookSettingsFile,
    cleanupHookSettingsFile,
} from '@/modules/common/hooks/generateHookSettings'

/** 每个用例生成的 settings 文件，测试结束统一清理 */
const generated: string[] = []

function generate(options: Parameters<typeof generateHookSettingsFile>[2]): {
    path: string
    settings: Record<string, unknown>
} {
    const path = generateHookSettingsFile(19999, 'test-token', options)
    generated.push(path)
    return { path, settings: JSON.parse(readFileSync(path, 'utf8')) }
}

afterEach(() => {
    for (const path of generated.splice(0)) {
        if (existsSync(path)) cleanupHookSettingsFile(path, 'test')
    }
})

describe('generateHookSettingsFile', () => {
    it('写出的 settings 含 SessionStart hook，command 带 port 与 token', () => {
        const { settings } = generate({ filenamePrefix: 'test', logLabel: 'test' })

        const hooks = settings.hooks as Record<string, unknown>
        const sessionStart = hooks.SessionStart as Array<Record<string, unknown>>
        expect(sessionStart).toHaveLength(1)
        expect(sessionStart[0].matcher).toBe('*')

        const inner = sessionStart[0].hooks as Array<Record<string, unknown>>
        expect(inner[0].type).toBe('command')
        expect(inner[0].command).toContain('hook-forwarder')
        expect(inner[0].command).toContain('19999')
        expect(inner[0].command).toContain('test-token')
    })

    it('未传 hooksEnabled 时不写 hooksConfig 字段', () => {
        const { settings } = generate({ filenamePrefix: 'test', logLabel: 'test' })
        expect(settings.hooksConfig).toBeUndefined()
    })

    it('hooksEnabled=false 写入 hooksConfig.enabled=false', () => {
        const { settings } = generate({
            filenamePrefix: 'test',
            logLabel: 'test',
            hooksEnabled: false,
        })
        expect(settings.hooksConfig).toEqual({ enabled: false })
    })

    it('未传 env 时不写 env 字段', () => {
        const { settings } = generate({ filenamePrefix: 'test', logLabel: 'test' })
        expect(settings.env).toBeUndefined()
    })

    it('传入 env 时原样写入 settings.env', () => {
        const { settings } = generate({
            filenamePrefix: 'test',
            logLabel: 'test',
            env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' },
        })
        expect(settings.env).toEqual({ CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' })
    })
})
