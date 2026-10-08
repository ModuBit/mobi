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
import { existsSync, mkdirSync, rmSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
    createLogger,
    cleanupOldLogs,
    findLatestLog,
} from '../src/logger'

// 测试用临时 logs 目录
const TEST_DIR = join(tmpdir(), 'mobi-test-logger')

describe('shared logger', () => {
    beforeEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
        mkdirSync(TEST_DIR, { recursive: true })
    })

    afterEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
    })

    it('createLogger 写文件，文件名含 processType', () => {
        const log = createLogger({ processType: 'hub', logsDir: TEST_DIR, cleanup: false })
        log.info('hello hub')
        const path = log.getLogPath()
        expect(existsSync(path)).toBe(true)
        expect(path.endsWith('-hub.log')).toBe(true)
    })

    it('info 落盘格式：[ts] [hub] INFO 消息', () => {
        const log = createLogger({ processType: 'hub', logsDir: TEST_DIR, cleanup: false })
        log.info('starting up')
        const content = readFileSync(log.getLogPath(), 'utf8')
        expect(content).toMatch(/\[.*\] \[hub\] INFO starting up\n$/)
    })

    it('debug 进 ringBuffer', () => {
        const log = createLogger({ processType: 'runner', logsDir: TEST_DIR, cleanup: false })
        log.debug('dbg msg')
        expect(log.snapshot()).toContain('debug dbg msg')
    })

    it('warn/error 格式正确', () => {
        const log = createLogger({ processType: 'cli', logsDir: TEST_DIR, cleanup: false })
        log.warn('careful')
        log.error('boom')
        const content = readFileSync(log.getLogPath(), 'utf8')
        expect(content).toMatch(/\[cli\] WARN careful/)
        expect(content).toMatch(/\[cli\] ERROR boom/)
    })

    it('findLatestLog 返回指定 processType 的最新文件', () => {
        const old = join(TEST_DIR, '2020-01-01-00-00-00-pid-99999981-cli.log')
        const fresh = join(TEST_DIR, '2026-07-23-00-00-00-pid-99999982-cli.log')
        writeFileSync(old, 'old')
        writeFileSync(fresh, 'new')
        writeFileSync(join(TEST_DIR, '2026-07-23-00-00-00-pid-99999983-daemon.log'), 'other type')
        // findLatestLog 按 mtime 判新旧——必须显式设置 mtime 与文件名时间戳一致：
        // CI 上 writeFileSync 连续创建的文件 mtime 可能同 tick，排序退化取决于 readdir 顺序（环境随机）
        utimesSync(old, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'))
        utimesSync(fresh, new Date('2026-07-23T00:00:00Z'), new Date('2026-07-23T00:00:00Z'))
        const latest = findLatestLog(TEST_DIR, 'cli')
        expect(latest).not.toBeNull()
        expect(latest!.endsWith('pid-99999982-cli.log')).toBe(true)
    })

    it('findLatestLog 历史文件名（-hub.log / -runner.log）归入 daemon 桶', () => {
        const legacyHub = join(TEST_DIR, '2026-07-22-00-00-00-pid-99999981-hub.log')
        const legacyRunner = join(TEST_DIR, '2026-07-23-00-00-00-pid-99999982-runner.log')
        writeFileSync(legacyHub, 'old')
        writeFileSync(legacyRunner, 'new')
        utimesSync(legacyHub, new Date('2026-07-22T00:00:00Z'), new Date('2026-07-22T00:00:00Z'))
        utimesSync(legacyRunner, new Date('2026-07-23T00:00:00Z'), new Date('2026-07-23T00:00:00Z'))
        const latest = findLatestLog(TEST_DIR, 'daemon')
        expect(latest).not.toBeNull()
        expect(latest!.endsWith('pid-99999982-runner.log')).toBe(true)
    })

    it('findLatestLog 无匹配返回 null', () => {
        expect(findLatestLog(TEST_DIR, 'daemon')).toBeNull()
    })

    it('cleanupOldLogs 删超龄文件，保留 exits.log 与新文件', () => {
        const old = join(TEST_DIR, '2020-01-01-00-00-00-pid-99999981-runner.log')
        const fresh = join(TEST_DIR, '2026-07-23-00-00-00-pid-99999982-runner.log')
        const exits = join(TEST_DIR, 'exits.log')
        writeFileSync(old, 'x')
        writeFileSync(fresh, 'x')
        writeFileSync(exits, 'x')
        const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
        utimesSync(old, oldDate, oldDate)

        const { removed } = cleanupOldLogs(TEST_DIR)

        expect(removed).toBeGreaterThanOrEqual(1)
        expect(existsSync(old)).toBe(false)
        expect(existsSync(fresh)).toBe(true)
        expect(existsSync(exits)).toBe(true)
    })

    it('cleanupOldLogs 超龄也不删存活进程的日志（保命优先）', () => {
        // 长跑 daemon 写日志频率低，mtime 可能远早于测试等短命进程产生的日志；
        // 若按 mtime/数量裁剪，会把仍在运行的进程日志删掉（2026-10-07 生产假死排查时
        // 74546 的运行日志即被如此清掉）。文件名含 pid，据此保护存活进程。
        const alive = join(TEST_DIR, `2020-01-01-00-00-00-pid-${process.pid}-daemon.log`)
        const dead = join(TEST_DIR, '2020-01-01-00-00-00-pid-99999999-daemon.log')
        writeFileSync(alive, 'x')
        writeFileSync(dead, 'x')
        const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
        utimesSync(alive, oldDate, oldDate)
        utimesSync(dead, oldDate, oldDate)

        cleanupOldLogs(TEST_DIR)

        expect(existsSync(alive)).toBe(true)
        expect(existsSync(dead)).toBe(false)
    })

    it('cleanupOldLogs keepPerType 裁剪跳过存活进程日志', () => {
        const alive = join(TEST_DIR, `2026-07-20-00-00-00-pid-${process.pid}-daemon.log`)
        const deadFiles = [
            '2026-07-21-00-00-00-pid-99999991-daemon.log',
            '2026-07-22-00-00-00-pid-99999992-daemon.log',
            '2026-07-23-00-00-00-pid-99999993-daemon.log',
        ]
        const now = Date.now()
        const write = (p: string, ageHours: number) => {
            writeFileSync(p, 'x')
            const d = new Date(now - ageHours * 60 * 60 * 1000)
            utimesSync(p, d, d)
        }
        write(alive, 3) // 存活进程日志反而是最旧的
        deadFiles.forEach((f, i) => write(join(TEST_DIR, f), 2 - i))

        const { removed } = cleanupOldLogs(TEST_DIR, { keepPerType: 1 })

        // 存活日志不占名额也不被裁剪；死进程日志按保留数裁掉最旧 2 个
        expect(removed).toBe(2)
        expect(existsSync(alive)).toBe(true)
        expect(existsSync(join(TEST_DIR, deadFiles[2]!))).toBe(true)
    })

    it('cleanupOldLogs 单类超 keepPerType 时删最旧', () => {
        // 造 3 个 runner 日志，keepPerType=1，应删最旧 2 个。
        // mtime 显式设置为 now-2h/-1h/now（确定性 + 均不超 maxAgeDays 默认 7 天）：
        // writeFileSync 连续创建的文件 mtime 在 CI 上可能同 tick，排序退化取决于 readdir 顺序（环境随机）
        const files = ['2026-07-20-00-00-00-pid-99999981-runner.log', '2026-07-21-00-00-00-pid-99999982-runner.log', '2026-07-22-00-00-00-pid-99999983-runner.log']
        const now = Date.now()
        const ages = [2, 1, 0]
        files.forEach((f, i) => {
            const p = join(TEST_DIR, f)
            writeFileSync(p, 'x')
            const d = new Date(now - ages[i]! * 60 * 60 * 1000)
            utimesSync(p, d, d)
        })

        const { removed } = cleanupOldLogs(TEST_DIR, { keepPerType: 1 })

        expect(removed).toBe(2)
        // 最新保留
        expect(existsSync(join(TEST_DIR, files[2]!))).toBe(true)
    })
})
