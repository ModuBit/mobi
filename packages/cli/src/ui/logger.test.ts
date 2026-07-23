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
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Logger } from './logger'

const TEST_DIR = join(tmpdir(), 'mobi-test-cli-logger')

describe('cli Logger', () => {
    beforeEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
        mkdirSync(TEST_DIR, { recursive: true })
    })

    afterEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
    })

    it('继承 shared BaseLogger，info 落盘统一格式', () => {
        const path = join(TEST_DIR, '2026-07-23-00-00-00-pid-1.log')
        const log = new Logger(path, { ringBufferCapacity: 5 })
        log.info('hi')

        expect(existsSync(path)).toBe(true)
        // 测试进程为 cli（非 runner）
        expect(readFileSync(path, 'utf8')).toMatch(/\[cli\] INFO hi/)
    })

    it('debugLargeJson 落盘带 JSON 体', () => {
        const path = join(TEST_DIR, '2026-07-23-00-00-00-pid-2.log')
        const log = new Logger(path)
        log.debugLargeJson('payload', { a: 1 })

        const content = readFileSync(path, 'utf8')
        expect(content).toMatch(/DEBUG payload/)
        expect(content).toContain('"a": 1')
    })

    it('snapshot/getRecentEntries 返回 ringBuffer 内容', () => {
        const path = join(TEST_DIR, '2026-07-23-00-00-00-pid-3.log')
        const log = new Logger(path)
        log.debug('ring test')

        expect(log.snapshot()).toEqual(log.getRecentEntries())
        expect(log.getRecentEntries().some(e => e.includes('ring test'))).toBe(true)
    })
})
