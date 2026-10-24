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
import { analyzeDropRange } from '../../../src/claude/utils/transcriptScan'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
    getSessionMessages: vi.fn(),
}))

const mocked = vi.mocked(getSessionMessages)

/** 最小 user entry（content 字符串形态） */
function userMsg(uuid: string, text: string) {
    return { type: 'user', uuid, session_id: 'sess', message: { content: text }, parent_tool_use_id: null, parent_agent_id: null }
}

/** 最小 assistant entry（占位） */
function assistantMsg(uuid: string) {
    return { type: 'assistant', uuid, session_id: 'sess', message: { content: [] }, parent_tool_use_id: null, parent_agent_id: null }
}

/** 工具结果载体 user entry（归因到所属轮，不计入轮数） */
function toolResultMsg(uuid: string) {
    return {
        type: 'user', uuid, session_id: 'sess', parent_tool_use_id: null, parent_agent_id: null,
        message: { content: [{ type: 'tool_result', content: 'ok' }] },
    }
}

/** 中断标记 user entry（真实形态：text blocks 数组，F2 事故 transcript 实录） */
function interruptMarker(uuid: string) {
    return {
        type: 'user', uuid, session_id: 'sess', parent_tool_use_id: null, parent_agent_id: null,
        message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] },
    }
}

/** 真实事故形态（2026-09-29，9b4b2bbe）：跨会话入站消息以 user entry 落 transcript，
 *  内容为 `<cross-session-message from-name=... from-session-id=...>` 载体 */
function crossSessionMsg(uuid: string) {
    return userMsg(uuid, '<cross-session-message from-name="其他会话" from-session-id="d68407db">hi</cross-session-message>')
}

/** 被中断轮的完整形态：目标 user + tool_result 载体 + 中断标记 + assistant */
function interruptedTurn(userUuid: string, text: string) {
    return [userMsg(userUuid, text), assistantMsg(`tu-${userUuid}`), toolResultMsg(`tr-${userUuid}`), interruptMarker(`im-${userUuid}`)]
}

describe('analyzeDropRange（rewind 丢弃区间分析：轮数 + 跨会话归因）', () => {
    beforeEach(() => {
        mocked.mockReset()
    })

    it('单轮区间（被中断轮：tool_result / 中断标记归因所属轮）→ droppedTurns 1', async () => {
        mocked.mockResolvedValueOnce([
            assistantMsg('a1'),
            ...interruptedTurn('target', '用 Bash 运行 sleep 90'),
        ] as never)

        await expect(analyzeDropRange('sess', '/dir', 'a1')).resolves.toEqual({
            droppedTurns: 1,
            crossSessionEntry: null,
        })
    })

    it('多轮区间（目标轮 + 后续完整轮）→ droppedTurns 2', async () => {
        mocked.mockResolvedValueOnce([
            assistantMsg('a1'),
            ...interruptedTurn('target', '第一轮消息'),
            userMsg('next-turn', '第二轮消息'),
            assistantMsg('a-next'),
        ] as never)

        await expect(analyzeDropRange('sess', '/dir', 'a1')).resolves.toEqual({
            droppedTurns: 2,
            crossSessionEntry: null,
        })
    })

    it('中断标记的字符串形态同样不计入轮数', async () => {
        mocked.mockResolvedValueOnce([
            assistantMsg('a1'),
            userMsg('target', '中断我'),
            userMsg('mk-str', '[Request interrupted by user for tool use]'),
            assistantMsg('a2'),
        ] as never)

        await expect(analyzeDropRange('sess', '/dir', 'a1')).resolves.toEqual({
            droppedTurns: 1,
            crossSessionEntry: null,
        })
    })

    it('区间含跨会话条目 → 不计入轮数但 crossSessionEntry 返回其 uuid（守卫单轮路径据此预检拒绝）', async () => {
        mocked.mockResolvedValueOnce([
            assistantMsg('a1'),
            userMsg('target', '目标轮'),
            crossSessionMsg('cs-1'),
        ] as never)

        await expect(analyzeDropRange('sess', '/dir', 'a1')).resolves.toEqual({
            droppedTurns: 1,
            crossSessionEntry: 'cs-1',
        })
    })

    it('跨会话条目 text blocks 数组形态同样命中', async () => {
        mocked.mockResolvedValueOnce([
            userMsg('anchor', '回退到这里'),
            {
                type: 'user', uuid: 'cs-blocks', session_id: 'sess', parent_tool_use_id: null, parent_agent_id: null,
                message: { content: [{ type: 'text', text: '<cross-session-message from-name="x">yo</cross-session-message>' }] },
            },
        ] as never)

        await expect(analyzeDropRange('sess', '/dir', 'anchor')).resolves.toEqual({
            droppedTurns: 0,
            crossSessionEntry: 'cs-blocks',
        })
    })

    it('锚点跨页命中后继续扫到末尾（区间跨页）', async () => {
        const page1 = [assistantMsg('a0'), ...Array.from({ length: 49 }, (_, i) => assistantMsg(`p1-${i}`)), userMsg('anchor', '回退到这里')]
        mocked.mockResolvedValueOnce(page1 as never)
        mocked.mockResolvedValueOnce([userMsg('next-page-turn', '跨页的下一轮'), crossSessionMsg('cs-next-page')] as never)

        await expect(analyzeDropRange('sess', '/dir', 'anchor')).resolves.toEqual({
            droppedTurns: 1,
            crossSessionEntry: 'cs-next-page',
        })
        expect(mocked).toHaveBeenNthCalledWith(2, 'sess', { dir: '/dir', limit: 50, offset: 50 })
    })

    it('锚点不存在（transcript 已变）→ null（调用方保守处理，由 SDK 兜底）', async () => {
        mocked.mockResolvedValueOnce([assistantMsg('a1')] as never)

        await expect(analyzeDropRange('sess', '/dir', 'ghost')).resolves.toBeNull()
    })

    it('assistant entry 即使内容含标记也不命中跨会话判定（只查 user entry）', async () => {
        mocked.mockResolvedValueOnce([
            userMsg('anchor', '回退到这里'),
            {
                type: 'assistant', uuid: 'fake-a', session_id: 'sess', parent_tool_use_id: null, parent_agent_id: null,
                message: { content: '<cross-session-message>x</cross-session-message>' },
            },
        ] as never)

        await expect(analyzeDropRange('sess', '/dir', 'anchor')).resolves.toEqual({
            droppedTurns: 0,
            crossSessionEntry: null,
        })
    })
})
