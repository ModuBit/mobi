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
import { findLatestLog } from '@mobi/shared/logger'

const TEST_DIR = join(tmpdir(), 'mobi-test-logs-cmd')

describe('logs 命令核心：findLatestLog', () => {
    beforeEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
        mkdirSync(TEST_DIR, { recursive: true })
    })

    afterEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
    })

    it('hub/runner/cli 各自最新可定位', () => {
        writeFileSync(join(TEST_DIR, '2026-07-23-01-00-00-pid-1-runner.log'), '')
        writeFileSync(join(TEST_DIR, '2026-07-23-02-00-00-pid-2-runner.log'), '')
        writeFileSync(join(TEST_DIR, '2026-07-23-03-00-00-pid-3-hub.log'), '')
        writeFileSync(join(TEST_DIR, '2026-07-23-04-00-00-pid-4-cli.log'), '')

        expect(findLatestLog(TEST_DIR, 'runner')!.endsWith('02-00-00-pid-2-runner.log')).toBe(true)
        expect(findLatestLog(TEST_DIR, 'hub')!.endsWith('pid-3-hub.log')).toBe(true)
        expect(findLatestLog(TEST_DIR, 'cli')!.endsWith('pid-4-cli.log')).toBe(true)
    })

    it('无匹配返回 null', () => {
        expect(findLatestLog(TEST_DIR, 'hub')).toBeNull()
    })
})
