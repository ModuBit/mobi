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

import { describe, it, expect, beforeEach } from 'vitest'
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

    it('默认状态：hub/runner 均不托管，host/port 取默认值', () => {
        const state = defaultDesiredState()
        expect(state).toEqual({ hub: false, runner: false, host: '127.0.0.1', port: 2222 })
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

    it('非法 JSON 返回 null（视为无状态）', () => {
        writeFileSync(stateFile, '{oops')
        expect(readDesiredState(stateFile)).toBeNull()
    })
})
