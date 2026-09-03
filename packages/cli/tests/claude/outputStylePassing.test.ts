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

import { describe, it, expect, vi } from 'vitest'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { OUTPUT_STYLE_EXIT_SENTINEL } from '../../src/claude/utils/outputStyleSentinel'
import { REWIND_EXIT_SENTINEL } from '../../src/claude/utils/rewindSentinel'
import { applyStartupOutputStyle } from '../../src/claude/claudeRemote'

/** 最小 Query 桩：只实现被测的 applyFlagSettings */
const fakeQuery = (applyFlagSettings: Query['applyFlagSettings']): Query =>
    ({ applyFlagSettings }) as unknown as Query

describe('outputStyle sentinel', () => {
    it('与 rewind 哨兵互异（launcher 按值区分丢弃行为）', () => {
        expect(OUTPUT_STYLE_EXIT_SENTINEL).not.toBe(REWIND_EXIT_SENTINEL)
    })

    it('带 NUL 前缀（Web 输入无法产生控制字符，用户消息不可能碰撞）', () => {
        expect(OUTPUT_STYLE_EXIT_SENTINEL.startsWith('\x00')).toBe(true)
    })
})

describe('applyStartupOutputStyle', () => {
    it('outputStyle 非空时经 applyFlagSettings 注入 flag layer', async () => {
        const fn = vi.fn().mockResolvedValue(undefined)
        await applyStartupOutputStyle(fakeQuery(fn), 'explanatory')
        expect(fn).toHaveBeenCalledWith({ outputStyle: 'explanatory' })
    })

    it('outputStyle 为空时不调用（CC 读 settings 默认）', async () => {
        const fn = vi.fn().mockResolvedValue(undefined)
        await applyStartupOutputStyle(fakeQuery(fn), undefined)
        expect(fn).not.toHaveBeenCalled()
    })

    it('applyFlagSettings 失败时吞掉并降级（不阻塞会话启动）', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('boom'))
        await expect(applyStartupOutputStyle(fakeQuery(fn), 'explanatory')).resolves.toBeUndefined()
    })
})
