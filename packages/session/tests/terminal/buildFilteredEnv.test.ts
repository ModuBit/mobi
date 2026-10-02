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

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildFilteredEnv } from '@/terminal/TerminalManager'

/**
 * buildFilteredEnv 行为锁定：
 * - 复制 process.env 非空变量
 * - 过滤敏感 key（token / api key）
 * - TERM 缺失/空时补 xterm-256color（PTY 必须有明确 TERM）
 */
describe('buildFilteredEnv', () => {
    const originalEnv = { ...process.env }

    beforeEach(() => {
        // 每个用例从干净基线开始
        process.env = { ...originalEnv }
    })

    afterEach(() => {
        process.env = { ...originalEnv }
    })

    it('复制普通环境变量', () => {
        process.env.MOBI_TEST_PLAIN = 'hello'
        expect(buildFilteredEnv().MOBI_TEST_PLAIN).toBe('hello')
    })

    it('跳过空值变量', () => {
        process.env.MOBI_TEST_EMPTY = ''
        expect(buildFilteredEnv().MOBI_TEST_EMPTY).toBeUndefined()
    })

    it('过滤敏感 key（token / api key）', () => {
        process.env.CLI_API_TOKEN = 'secret-token'
        process.env.ANTHROPIC_API_KEY = 'sk-xxx'
        process.env.OPENAI_API_KEY = 'sk-yyy'
        const env = buildFilteredEnv()
        expect(env.CLI_API_TOKEN).toBeUndefined()
        expect(env.ANTHROPIC_API_KEY).toBeUndefined()
        expect(env.OPENAI_API_KEY).toBeUndefined()
    })

    it('保留普通变量同时过滤敏感变量', () => {
        process.env.PATH = '/usr/bin:/bin'
        process.env.CLI_API_TOKEN = 'secret'
        const env = buildFilteredEnv()
        expect(env.PATH).toBe('/usr/bin:/bin')
        expect(env.CLI_API_TOKEN).toBeUndefined()
    })

    it('TERM 缺失时补 xterm-256color', () => {
        delete process.env.TERM
        expect(buildFilteredEnv().TERM).toBe('xterm-256color')
    })

    it('TERM 为空时补 xterm-256color', () => {
        process.env.TERM = ''
        expect(buildFilteredEnv().TERM).toBe('xterm-256color')
    })

    it('TERM 已存在时不覆盖', () => {
        process.env.TERM = 'screen-256color'
        expect(buildFilteredEnv().TERM).toBe('screen-256color')
    })
})
