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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
    defaultDesiredState,
    readDesiredState,
    writeDesiredState,
    type SupervisorDesiredState,
} from '@/supervisor/desiredState'

const TEST_DIR = join(tmpdir(), 'mobi-test-desired-state')

describe('supervisor 期望状态持久化', () => {
    const stateFile = join(TEST_DIR, 'supervisor-state.json')

    beforeEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
        mkdirSync(TEST_DIR, { recursive: true })
    })

    afterEach(() => {
        vi.unstubAllEnvs()
        delete process.env.MOBI_LISTEN_PORT
    })

    it('默认状态：hub/runner 均不托管，host/port 取默认值', () => {
        delete process.env.MOBI_LISTEN_PORT
        const state = defaultDesiredState()
        expect(state).toEqual({ hub: false, runner: false, host: '127.0.0.1', port: 2222 })
    })

    it('默认端口感知 profile：MOBI_LISTEN_PORT 设置时取 profile 端口（e2e=2224 / dev=2223）', () => {
        // 背景：supervisor 由 CLI spawn 时继承 profile env；desired state 为空时若硬编码
        // 2222，`mobi hub start --profile e2e` 不带 --port 会与 default 环境 hub 撞端口
        vi.stubEnv('MOBI_LISTEN_PORT', '2224')
        expect(defaultDesiredState().port).toBe(2224)
        vi.stubEnv('MOBI_LISTEN_PORT', '2223')
        expect(defaultDesiredState().port).toBe(2223)
    })

    it('MOBI_LISTEN_PORT 非法值（浮点/越界/非数字）回落 2222', () => {
        for (const bad of ['33.5', '0', '70000', 'abc']) {
            vi.stubEnv('MOBI_LISTEN_PORT', bad)
            expect(defaultDesiredState().port).toBe(2222)
        }
    })

    it('readDesiredState 损坏端口回落也感知 profile 端口', () => {
        vi.stubEnv('MOBI_LISTEN_PORT', '2224')
        writeFileSync(stateFile, JSON.stringify({ hub: true, runner: false, host: '127.0.0.1', port: 'x' }))
        expect(readDesiredState(stateFile)?.port).toBe(2224)
    })

    it('文件不存在时 read 返回 null', () => {
        expect(readDesiredState(stateFile)).toBeNull()
    })

    it('写入后可读回', () => {
        const state: SupervisorDesiredState = { hub: true, runner: false, host: '0.0.0.0', port: 3333 }
        writeDesiredState(state, stateFile)
        expect(readDesiredState(stateFile)).toEqual(state)
    })

    it('损坏/缺字段的 JSON 被容错归一：布尔强制、非法端口回落默认', () => {
        writeFileSync(stateFile, JSON.stringify({ hub: 1, runner: 'yes', host: 123, port: 'x' }))
        expect(readDesiredState(stateFile)).toEqual({ hub: true, runner: true, host: '127.0.0.1', port: 2222 })
    })

    it('非整数端口（浮点）归一为默认端口', () => {
        writeFileSync(stateFile, JSON.stringify({ hub: true, runner: false, host: '127.0.0.1', port: 3333.5 }))
        expect(readDesiredState(stateFile)).toEqual({ hub: true, runner: false, host: '127.0.0.1', port: 2222 })
    })

    it('非法 JSON 返回 null（视为无状态）', () => {
        writeFileSync(stateFile, '{oops')
        expect(readDesiredState(stateFile)).toBeNull()
    })
})
