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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk'
import { findRewindAnchor } from '../../../src/claude/utils/rewindAnchor'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
    getSessionMessages: vi.fn(),
}))

/** 构造最小 SessionMessage 形态 */
function msg(type: 'user' | 'assistant' | 'system', uuid: string) {
    return { type, uuid, session_id: 'sess', message: null, parent_tool_use_id: null, parent_agent_id: null }
}

const mocked = vi.mocked(getSessionMessages)

/**
 * 锚点换算：用户消息 uuid → 其前最近一条 assistant entry uuid（resumeSessionAt 保留锚）。
 * 分页方向按 PoC poc8 实测：旧→新排序，offset 从头部正向跳过。
 * @see packages/cli/src/claude/utils/rewindAnchor.ts
 */
describe('findRewindAnchor', () => {
    beforeEach(() => {
        mocked.mockReset()
    })

    it('锚点存在 → 返回其前最近一条 assistant entry uuid', async () => {
        mocked.mockResolvedValueOnce([
            msg('user', 'u1'),
            msg('assistant', 'a1'),
            msg('user', 'u2'),
            msg('assistant', 'a2'),
            msg('user', 'u3'),
        ] as never)

        await expect(findRewindAnchor('sess', '/dir', 'u3')).resolves.toBe('a2')
        expect(mocked).toHaveBeenCalledWith('sess', { dir: '/dir', limit: 50, offset: 0 })
    })

    it('锚点在第二页命中 → 前驱 assistant 可跨页（已扫前缀内）', async () => {
        const page1 = Array.from({ length: 50 }, (_, i) => msg(i % 2 === 0 ? 'user' : 'assistant', `p1-${i}`))
        mocked.mockResolvedValueOnce(page1 as never)
        mocked.mockResolvedValueOnce([msg('user', 'target')] as never)

        // 第二页首位是锚点，其前驱是第一页最后一条 entry（p1-49 为 assistant）
        await expect(findRewindAnchor('sess', '/dir', 'target')).resolves.toBe('p1-49')
        expect(mocked).toHaveBeenCalledTimes(2)
        expect(mocked).toHaveBeenNthCalledWith(2, 'sess', { dir: '/dir', limit: 50, offset: 50 })
    })

    it('锚点前紧邻的是 tool_result 载体（user 类型）→ 跳过继续向前取 assistant', async () => {
        mocked.mockResolvedValueOnce([
            msg('user', 'u0'),
            msg('assistant', 'a0'),
            msg('user', 'tool-result-carrier'),  // user 类型但非用户输入
            msg('user', 'u1'),
        ] as never)

        await expect(findRewindAnchor('sess', '/dir', 'u1')).resolves.toBe('a0')
    })

    it('锚点是链首 → null（无可保留前驱，调用方按拒绝处理）', async () => {
        mocked.mockResolvedValueOnce([msg('user', 'u1'), msg('assistant', 'a1')] as never)

        await expect(findRewindAnchor('sess', '/dir', 'u1')).resolves.toBeNull()
    })

    it('锚点不存在（假锚点 / 换链旧行）→ null', async () => {
        mocked.mockResolvedValueOnce([
            msg('user', 'u1'),
            msg('assistant', 'a1'),
            msg('user', 'u2'),
        ] as never)

        await expect(findRewindAnchor('sess', '/dir', 'ghost')).resolves.toBeNull()
    })

    it('分页扫到空页（transcript 不存在）→ null', async () => {
        mocked.mockResolvedValueOnce([] as never)

        await expect(findRewindAnchor('sess', '/dir', 'u1')).resolves.toBeNull()
    })

    it('uuid 精确匹配：同页其它 user 条目不干扰定位', async () => {
        mocked.mockResolvedValueOnce([
            msg('assistant', 'a-pre'),
            msg('user', 'other-user'),
            msg('user', 'target'),
        ] as never)

        // target 的紧邻前驱是 other-user（user 类型），须跳过取 a-pre
        await expect(findRewindAnchor('sess', '/dir', 'target')).resolves.toBe('a-pre')
    })
})
