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
import { Logger } from '@/ui/logger'

const TEST_DIR = join(tmpdir(), 'mobi-test-cli-logger')

/**
 * 两个关注点：ring buffer 的内容/容量（崩溃 dump 用），以及按 DEBUG 开关的落盘行为。
 * 二者都发生在 Logger 内部，用例仍走同一个入口。
 */
describe('cli Logger', () => {
    beforeEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
        mkdirSync(TEST_DIR, { recursive: true })
    })

    afterEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
    })

    // ── ring buffer ──
    // entry 格式：`${level} ${message} ${args}`（带级别前缀，崩溃 dump 更可读）
    it('snapshot 返回最近 debug（顺序保留）', () => {
        const logger = new Logger(join(TEST_DIR, 'ring-a.log'))
        logger.debug('a')
        logger.debug('b')
        logger.debug('c')
        expect(logger.getRecentEntries()).toEqual(['debug a', 'debug b', 'debug c'])
        expect(logger.snapshot()).toEqual(['debug a', 'debug b', 'debug c'])
    })

    it('超过容量时保留最后 N 条', () => {
        const logger = new Logger(join(TEST_DIR, 'ring-b.log'), { ringBufferCapacity: 3 })
        for (let i = 0; i < 5; i++) logger.debug(`line-${i}`)
        expect(logger.getRecentEntries()).toEqual(['debug line-2', 'debug line-3', 'debug line-4'])
    })

    it('args 被序列化进 ring buffer', () => {
        const logger = new Logger(join(TEST_DIR, 'ring-c.log'))
        logger.debug('ctx', { k: 1 })
        expect(logger.getRecentEntries()).toEqual(['debug ctx {"k":1}'])
    })

    // ── 落盘 ──
    it('继承 shared BaseLogger，info 落盘统一格式', () => {
        const path = join(TEST_DIR, 'write-info.log')
        const log = new Logger(path, { ringBufferCapacity: 5 })
        log.info('hi')

        expect(existsSync(path)).toBe(true)
        // 测试进程为 cli（非 runner）
        expect(readFileSync(path, 'utf8')).toMatch(/\[cli\] INFO hi/)
    })

    it('debug 生产模式（!DEBUG）不落盘但进 ringBuffer', () => {
        const path = join(TEST_DIR, 'write-debug-quiet.log')
        const log = new Logger(path, { ringBufferCapacity: 5 })
        log.debug('dbg quiet')

        expect(existsSync(path)).toBe(false)
        expect(log.snapshot().some((e) => e.includes('dbg quiet'))).toBe(true)
    })

    it('debug DEBUG 模式落盘', () => {
        const prev = process.env.DEBUG
        process.env.DEBUG = '1'
        try {
            const path = join(TEST_DIR, 'write-debug-verbose.log')
            const log = new Logger(path)
            log.debug('dbg verbose')
            expect(readFileSync(path, 'utf8')).toMatch(/\[cli\] DEBUG dbg verbose/)
        } finally {
            if (prev === undefined) delete process.env.DEBUG
            else process.env.DEBUG = prev
        }
    })

    it('debugLargeJson 生产模式（!DEBUG）不落盘', () => {
        const path = join(TEST_DIR, 'write-json-quiet.log')
        const log = new Logger(path)
        log.debugLargeJson('payload', { a: 1 })
        expect(existsSync(path)).toBe(false)
    })

    it('debugLargeJson DEBUG 模式落盘带 JSON 体', () => {
        const prev = process.env.DEBUG
        process.env.DEBUG = '1'
        try {
            const path = join(TEST_DIR, 'write-json-verbose.log')
            const log = new Logger(path)
            log.debugLargeJson('payload', { a: 1 })
            const content = readFileSync(path, 'utf8')
            expect(content).toMatch(/DEBUG payload/)
            expect(content).toContain('"a": 1')
        } finally {
            if (prev === undefined) delete process.env.DEBUG
            else process.env.DEBUG = prev
        }
    })

    it('snapshot / getRecentEntries 返回同一份 ringBuffer 内容', () => {
        const path = join(TEST_DIR, 'write-ring-same.log')
        const log = new Logger(path)
        log.debug('ring test')

        expect(log.snapshot()).toEqual(log.getRecentEntries())
        expect(log.getRecentEntries().some((e) => e.includes('ring test'))).toBe(true)
    })
})
