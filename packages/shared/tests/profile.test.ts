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

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
    loadProfile,
    getProfilesDir,
    listProfiles,
    getProfilePath,
    parseEnvFile,
} from '../src/profile'

// 测试用的临时 profile 目录
const TEST_PROFILES_DIR = join(tmpdir(), 'mobi-test-profiles')

describe('profile', () => {
    beforeEach(() => {
        // 清理并创建测试目录
        if (existsSync(TEST_PROFILES_DIR)) {
            rmSync(TEST_PROFILES_DIR, { recursive: true })
        }
        mkdirSync(TEST_PROFILES_DIR, { recursive: true })

        // 清理测试用的环境变量
        delete process.env._TEST_VAR1
        delete process.env._TEST_VAR2
    })

    afterEach(() => {
        if (existsSync(TEST_PROFILES_DIR)) {
            rmSync(TEST_PROFILES_DIR, { recursive: true })
        }
        delete process.env._TEST_VAR1
        delete process.env._TEST_VAR2
    })

    describe('parseEnvFile', () => {
        it('解析标准 KEY=VALUE 行', () => {
            const content = 'KEY1=value1\nKEY2=value2\n'
            const result = parseEnvFile(content)
            expect(result).toEqual({ KEY1: 'value1', KEY2: 'value2' })
        })

        it('忽略注释和空行', () => {
            const content = '# 这是注释\n\nKEY1=value1\n  # 缩进注释\nKEY2=value2\n'
            const result = parseEnvFile(content)
            expect(result).toEqual({ KEY1: 'value1', KEY2: 'value2' })
        })

        it('值可以包含等号', () => {
            const content = 'KEY=value=with=equals\n'
            const result = parseEnvFile(content)
            expect(result).toEqual({ KEY: 'value=with=equals' })
        })

        it('空值允许', () => {
            const content = 'KEY=\n'
            const result = parseEnvFile(content)
            expect(result).toEqual({ KEY: '' })
        })

        it('忽略没有等号的行', () => {
            const content = 'INVALID_LINE\nKEY=value\n'
            const result = parseEnvFile(content)
            expect(result).toEqual({ KEY: 'value' })
        })

        it('去除 KEY 前后空格', () => {
            const content = '  KEY  =value\n'
            const result = parseEnvFile(content)
            expect(result).toEqual({ KEY: 'value' })
        })

        it('去除 VALUE 前后空格', () => {
            const content = 'KEY=  value  \n'
            const result = parseEnvFile(content)
            expect(result).toEqual({ KEY: 'value' })
        })
    })

    describe('getProfilePath / getProfilesDir', () => {
        it('getProfilePath 返回正确的路径', () => {
            const path = getProfilePath('dev')
            expect(path).toMatch(/profiles\/dev\.env$/)
        })

        it('getProfilesDir 返回包含 profiles 的路径', () => {
            const dir = getProfilesDir()
            expect(dir).toMatch(/profiles$/)
        })
    })

    describe('listProfiles', () => {
        it('列出所有已定义的 profile', () => {
            // 创建测试 profile 文件
            writeFileSync(join(TEST_PROFILES_DIR, 'dev.env'), 'KEY=val\n')
            writeFileSync(join(TEST_PROFILES_DIR, 'e2e.env'), 'KEY=val\n')
            // 非 .env 文件应该被忽略
            writeFileSync(join(TEST_PROFILES_DIR, 'readme.md'), 'text\n')

            const profiles = listProfiles(TEST_PROFILES_DIR)
            expect(profiles).toContain('dev')
            expect(profiles).toContain('e2e')
            expect(profiles).toHaveLength(2)
        })

        it('目录不存在时返回空数组', () => {
            const profiles = listProfiles(join(tmpdir(), 'nonexistent-dir-xyz'))
            expect(profiles).toEqual([])
        })
    })

    describe('loadProfile', () => {
        it('从 args 中提取 --profile 名称并加载 env', () => {
            // 创建测试 profile
            writeFileSync(
                join(TEST_PROFILES_DIR, 'test.env'),
                '_TEST_VAR1=hello\n_TEST_VAR2=world\n'
            )

            const args = ['--profile', 'test', 'hub', 'start']
            const result = loadProfile(args, TEST_PROFILES_DIR)

            expect(result).toBe('test')
            expect(process.env._TEST_VAR1).toBe('hello')
            expect(process.env._TEST_VAR2).toBe('world')
        })

        it('支持 --profile=name 格式', () => {
            writeFileSync(
                join(TEST_PROFILES_DIR, 'test.env'),
                '_TEST_VAR1=val\n'
            )

            const args = ['--profile=test', 'runner', 'status']
            const result = loadProfile(args, TEST_PROFILES_DIR)

            expect(result).toBe('test')
            expect(process.env._TEST_VAR1).toBe('val')
        })

        it('从 args 中移除 --profile 参数', () => {
            writeFileSync(
                join(TEST_PROFILES_DIR, 'test.env'),
                '_TEST_VAR1=val\n'
            )

            const args = ['--profile', 'test', 'hub', 'start']
            const originalLength = args.length
            loadProfile(args, TEST_PROFILES_DIR)

            // args 应该被原地修改，移除了 --profile 和 name
            expect(args).toEqual(['hub', 'start'])
            expect(args.length).toBe(originalLength - 2)
        })

        it('不覆盖已设置的环境变量', () => {
            writeFileSync(
                join(TEST_PROFILES_DIR, 'test.env'),
                '_TEST_VAR1=from_profile\n'
            )
            process.env._TEST_VAR1 = 'from_env'

            const args = ['--profile', 'test']
            loadProfile(args, TEST_PROFILES_DIR)

            expect(process.env._TEST_VAR1).toBe('from_env')
        })

        it('没有 --profile 参数时返回 undefined', () => {
            const args = ['hub', 'start']
            const result = loadProfile(args, TEST_PROFILES_DIR)

            expect(result).toBeUndefined()
            expect(args).toEqual(['hub', 'start'])
        })

        it('profile 文件不存在时抛错', () => {
            const args = ['--profile', 'nonexistent']
            expect(() => loadProfile(args, TEST_PROFILES_DIR)).toThrow(
                /nonexistent/
            )
        })
    })
})
