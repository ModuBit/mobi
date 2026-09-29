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
import { findCrossSessionEntryAfter } from '../../../src/claude/utils/transcriptScan'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
    getSessionMessages: vi.fn(),
}))

const mocked = vi.mocked(getSessionMessages)

/** 最小 user entry（content 字符串形态） */
function userMsg(uuid: string, text: string) {
    return { type: 'user', uuid, session_id: 'sess', message: { content: text }, parent_tool_use_id: null, parent_agent_id: null }
}

/** 最小 assistant entry（无跨会话语义，仅占位） */
function assistantMsg(uuid: string) {
    return { type: 'assistant', uuid, session_id: 'sess', message: { content: [] }, parent_tool_use_id: null, parent_agent_id: null }
}

/** 真实事故形态（2026-09-29，9b4b2bbe）：跨会话入站消息以 user entry 落 transcript，
 *  内容为 `<cross-session-message from-name=... from-session-id=...>` 载体 */
function crossSessionMsg(uuid: string) {
    return userMsg(uuid, '<cross-session-message from-name="其他会话" from-session-id="d68407db">hi</cross-session-message>')
}

describe('findCrossSessionEntryAfter（rewind 丢弃区间的跨会话归因预检）', () => {
    beforeEach(() => {
        mocked.mockReset()
    })

    it('锚后区间含跨会话 user entry → 返回其 uuid', async () => {
        mocked.mockResolvedValueOnce([
            assistantMsg('a1'),
            userMsg('anchor', '回退到这里'),
            crossSessionMsg('cs-1'),
        ] as never)

        await expect(findCrossSessionEntryAfter('sess', '/dir', 'anchor')).resolves.toBe('cs-1')
    })

    it('锚点自身之后的条目才算区间（锚前跨会话条目无关）', async () => {
        mocked.mockResolvedValueOnce([
            crossSessionMsg('cs-0'),
            assistantMsg('a1'),
            userMsg('anchor', '回退到这里'),
            assistantMsg('a2'),
        ] as never)

        await expect(findCrossSessionEntryAfter('sess', '/dir', 'anchor')).resolves.toBeNull()
    })

    it('user entry content 为 text blocks 数组形态同样命中', async () => {
        mocked.mockResolvedValueOnce([
            userMsg('anchor', '回退到这里'),
            {
                type: 'user', uuid: 'cs-blocks', session_id: 'sess', parent_tool_use_id: null, parent_agent_id: null,
                message: { content: [{ type: 'text', text: '<cross-session-message from-name="x">yo</cross-session-message>' }] },
            },
        ] as never)

        await expect(findCrossSessionEntryAfter('sess', '/dir', 'anchor')).resolves.toBe('cs-blocks')
    })

    it('区间内只有本会话条目 → null（可回退）', async () => {
        mocked.mockResolvedValueOnce([
            userMsg('anchor', '回退到这里'),
            assistantMsg('a2'),
            userMsg('later', '后续消息'),
        ] as never)

        await expect(findCrossSessionEntryAfter('sess', '/dir', 'anchor')).resolves.toBeNull()
    })

    it('锚点跨页命中后继续扫到末尾（区间跨页）', async () => {
        const page1 = [assistantMsg('a0'), ...Array.from({ length: 49 }, (_, i) => assistantMsg(`p1-${i}`)), userMsg('anchor', '回退到这里')]
        mocked.mockResolvedValueOnce(page1 as never)
        mocked.mockResolvedValueOnce([crossSessionMsg('cs-next-page')] as never)

        await expect(findCrossSessionEntryAfter('sess', '/dir', 'anchor')).resolves.toBe('cs-next-page')
        expect(mocked).toHaveBeenNthCalledWith(2, 'sess', { dir: '/dir', limit: 50, offset: 50 })
    })

    it('锚点不存在（transcript 已变）→ null（放行，由 SDK 兜底拒绝）', async () => {
        mocked.mockResolvedValueOnce([assistantMsg('a1')] as never)

        await expect(findCrossSessionEntryAfter('sess', '/dir', 'ghost')).resolves.toBeNull()
    })

    it('assistant entry 即使内容含标记也不命中（只查 user entry）', async () => {
        mocked.mockResolvedValueOnce([
            userMsg('anchor', '回退到这里'),
            {
                type: 'assistant', uuid: 'fake-a', session_id: 'sess', parent_tool_use_id: null, parent_agent_id: null,
                message: { content: '<cross-session-message>x</cross-session-message>' },
            },
        ] as never)

        await expect(findCrossSessionEntryAfter('sess', '/dir', 'anchor')).resolves.toBeNull()
    })
})
