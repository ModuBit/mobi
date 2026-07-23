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

import { describe, it, expect } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Logger } from '../../src/ui/logger'

const fakeLogPath = join(tmpdir(), `mobi-logger-test-${process.pid}.log`)

describe('Logger ring buffer', () => {
  // ring buffer entry 格式：`${level} ${message} ${args}`（带级别前缀，崩溃 dump 更可读）
  it('snapshot 返回最近 debug（顺序保留）', () => {
    const logger = new Logger(fakeLogPath)
    logger.debug('a')
    logger.debug('b')
    logger.debug('c')
    expect(logger.getRecentEntries()).toEqual(['debug a', 'debug b', 'debug c'])
    expect(logger.snapshot()).toEqual(['debug a', 'debug b', 'debug c'])
  })

  it('超过容量时保留最后 N 条', () => {
    const logger = new Logger(fakeLogPath, { ringBufferCapacity: 3 })
    for (let i = 0; i < 5; i++) logger.debug(`line-${i}`)
    expect(logger.getRecentEntries()).toEqual(['debug line-2', 'debug line-3', 'debug line-4'])
  })

  it('args 被序列化进 ring buffer', () => {
    const logger = new Logger(fakeLogPath)
    logger.debug('ctx', { k: 1 })
    expect(logger.getRecentEntries()).toEqual(['debug ctx {"k":1}'])
  })
})
