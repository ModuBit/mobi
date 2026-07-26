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

import { describe, test, expect } from 'vitest'
import { buildClaudeFeatureEnv, CLAUDE_AGENT_TEAMS_ENV } from '../../src/claude/featureFlags'

describe('buildClaudeFeatureEnv', () => {
    test('全部关闭时返回空对象', () => {
        expect(buildClaudeFeatureEnv({ agentTeams: false, claudeEnv: {} })).toEqual({})
    })

    test('agentTeams 开启时注入 CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', () => {
        const env = buildClaudeFeatureEnv({ agentTeams: true, claudeEnv: {} })
        expect(env[CLAUDE_AGENT_TEAMS_ENV]).toBe('1')
    })

    test('claudeEnv 的变量被合并进返回', () => {
        const env = buildClaudeFeatureEnv({
            agentTeams: false,
            claudeEnv: { ANTHROPIC_LOG: 'debug', FOO: 'bar' },
        })
        expect(env.ANTHROPIC_LOG).toBe('debug')
        expect(env.FOO).toBe('bar')
    })

    test('claudeEnv 优先级高于内置开关（同名 key 由 claudeEnv 覆盖）', () => {
        // 用户在 settings.json 显式写 CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS，
        // 应覆盖内置 MOBI_AGENT_TEAMS 快捷开关的默认值 '1'
        const env = buildClaudeFeatureEnv({
            agentTeams: true,
            claudeEnv: { [CLAUDE_AGENT_TEAMS_ENV]: '0' },
        })
        expect(env[CLAUDE_AGENT_TEAMS_ENV]).toBe('0')
    })

    test('claudeEnv 非对象时防御为空（settings.json 写坏不致崩溃）', () => {
        const env = buildClaudeFeatureEnv({
            agentTeams: false,
            claudeEnv: 'not-an-object' as unknown as Record<string, string>,
        })
        expect(env).toEqual({})
    })

    test('claudeEnv 为数组时防御为空（数组也是 object，须显式排除）', () => {
        // settings.json 误写 "claudeEnv": ["a","b"] —— typeof==='object' 通过，
        // 但 Object.entries 会得到 [['0','a'],['1','b']]，值是 string 不被过滤，
        // 会注入名为 '0'/'1' 的环境变量。必须 Array.isArray 排除。
        const env = buildClaudeFeatureEnv({
            agentTeams: false,
            claudeEnv: ['ANTHROPIC_LOG', 'debug'] as unknown as Record<string, string>,
        })
        expect(env).toEqual({})
    })

    test('claudeEnv 值非 string 时跳过该键（保证返回类型 Record<string,string>）', () => {
        const env = buildClaudeFeatureEnv({
            agentTeams: false,
            claudeEnv: { OK: 'str', BAD: 123 as unknown as string },
        })
        expect(env.OK).toBe('str')
        expect(env.BAD).toBeUndefined()
    })
})
