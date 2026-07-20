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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { printExitReport } from '../../src/ui/exitLogReport'
import type { ExitRecord } from '@mobi/shared'

let logsDir: string

beforeEach(() => {
    logsDir = mkdtempSync(join(tmpdir(), 'mobi-exit-report-'))
})

afterEach(() => {
    rmSync(logsDir, { recursive: true, force: true })
})

function record(over: Partial<ExitRecord> = {}): ExitRecord {
    return {
        timestamp: '2026-07-20T01:00:00.000Z',
        processType: 'hub',
        pid: 123,
        exitCode: 0,
        signal: null,
        reason: 'normal',
        errorMessage: null,
        stackHead: null,
        uptimeMs: 1000,
        peakMemoryMb: 50,
        dumpFile: null,
        ...over
    }
}

function writeLines(...records: ExitRecord[]): void {
    appendFileSync(join(logsDir, 'exits.log'), records.map(r => JSON.stringify(r)).join('\n') + '\n')
}

function capture(fn: () => void): string {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
        fn()
        return log.mock.calls.map(c => c.join(' ')).join('\n')
    } finally {
        log.mockRestore()
    }
}

describe('printExitReport', () => {
    it('无记录时打印提示', () => {
        const out = capture(() => printExitReport({ logsDir }))
        expect(out).toContain('No exit records')
    })

    it('有记录时打印 reason / processType / errorMessage', () => {
        writeLines(record({ reason: 'crash-uncaught', errorMessage: 'boom' }))
        const out = capture(() => printExitReport({ logsDir }))
        expect(out).toContain('crash-uncaught')
        expect(out).toContain('HUB')
        expect(out).toContain('boom')
    })

    it('processFilter 过滤掉其他进程类型', () => {
        writeLines(
            record({ processType: 'hub', reason: 'normal' }),
            record({ processType: 'runner', pid: 456, reason: 'signal-term' })
        )
        const out = capture(() => printExitReport({ logsDir, processFilter: 'hub' }))
        expect(out).toContain('HUB')
        expect(out).toContain('normal')
        expect(out).not.toContain('RUNNER')
    })

    it('dumpFile 存在时打印 dump 路径', () => {
        writeLines(record({ reason: 'crash-uncaught', dumpFile: 'dumps/x.json' }))
        const out = capture(() => printExitReport({ logsDir }))
        expect(out).toContain('dumps/x.json')
    })
})
