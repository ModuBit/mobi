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

import { describe, it, expect, beforeEach } from 'vitest'
import type { ChatBlock, UserTextBlock, AgentEventBlock } from '@/domain/chat'
import { isRewindInProgress, isRewindCompletion, REWIND_COMMAND } from '@/domain/chat/presentation'
import {
    useRewindStore,
    parseRewindSseEvent,
    ingestRewindSseEvent,
} from '@/core/data/stores/rewindStore'

function userText(text: string): UserTextBlock {
    return { kind: 'user-text', id: `u-${text}`, localId: null, createdAt: 1000, text }
}

function agentEvent(type: string): AgentEventBlock {
    return { kind: 'agent-event', id: `e-${type}`, createdAt: 2000, event: { type } as AgentEventBlock['event'] }
}

/** 模拟 ChatContainer 的合成块追加：进行中 → 起点 REWIND_COMMAND；终态 → rewind-completed */
function withMarkers(blocks: ChatBlock[], inProgress: boolean): ChatBlock[] {
    if (inProgress) return [...blocks, userText(REWIND_COMMAND)]
    return [...blocks, agentEvent('rewind-completed')]
}

describe('isRewindInProgress（rewind 期间禁用 sender 的状态机）', () => {
    const history: ChatBlock[] = [userText('hello'), agentEvent('turn-result')]

    it('无 rewind 标记 → 不在进行中', () => {
        expect(isRewindInProgress(history)).toBe(false)
    })

    it('起点标记在尾部（POST 受理后）→ 进行中', () => {
        expect(isRewindInProgress(withMarkers(history, true))).toBe(true)
    })

    it('rewind-completed 到达 → 解禁（完成标志优先于起点标记）', () => {
        expect(isRewindInProgress(withMarkers(history, false))).toBe(false)
    })

    it('完成后用户发送新消息 → 仍不在进行中（不因历史起点标记复活）', () => {
        const after = [...withMarkers(history, false), userText('edited text')]
        expect(isRewindInProgress(after)).toBe(false)
    })

    it('isRewindCompletion 只认 rewind-completed（rewound-truncated 非终态）', () => {
        expect(isRewindCompletion(agentEvent('rewind-completed'))).toBe(true)
        expect(isRewindCompletion(agentEvent('rewound-truncated'))).toBe(false)
        expect(isRewindCompletion(userText(REWIND_COMMAND))).toBe(false)
    })
})

describe('rewindStore 状态机', () => {
    beforeEach(() => {
        // zustand 模块级单例，逐用例手动复位
        useRewindStore.setState({ progressBySession: new Map(), completionBySession: new Map() })
    })

    it('beginRewind → markTruncated → completeRewind 全链', () => {
        const sid = 'sess-1'
        useRewindStore.getState().beginRewind(sid, 'u1')
        let progress = useRewindStore.getState().progressBySession.get(sid)
        expect(progress?.nativeId).toBe('u1')
        expect(progress?.truncatedAt).toBeNull()

        useRewindStore.getState().markTruncated(sid, 3)
        progress = useRewindStore.getState().progressBySession.get(sid)
        expect(progress?.truncatedAt).not.toBeNull()
        expect(progress?.deleteFromSeq).toBe(3)

        useRewindStore.getState().completeRewind(sid, true)
        expect(useRewindStore.getState().progressBySession.has(sid)).toBe(false)
        const completion = useRewindStore.getState().completionBySession.get(sid)
        expect(completion?.filesRestored).toBe(true)
        expect(completion?.nativeId).toBe('u1')
    })

    it('markTruncated 无进行中态 → 忽略（页面重载后迟到的 truncated 不产生幽灵进度）', () => {
        useRewindStore.getState().markTruncated('sess-1', 3)
        expect(useRewindStore.getState().progressBySession.size).toBe(0)
    })

    it('clearSession 清理；beginRewind 清掉旧终态', () => {
        const sid = 'sess-1'
        useRewindStore.getState().beginRewind(sid, 'u1')
        useRewindStore.getState().completeRewind(sid, false, 'err')
        useRewindStore.getState().beginRewind(sid, 'u2')
        expect(useRewindStore.getState().completionBySession.has(sid)).toBe(false)
        useRewindStore.getState().completeRewind(sid, true)
        useRewindStore.getState().clearSession(sid)
        expect(useRewindStore.getState().completionBySession.size).toBe(0)
    })
})

describe('rewind SSE 事件接入', () => {
    beforeEach(() => {
        useRewindStore.setState({ progressBySession: new Map(), completionBySession: new Map() })
    })

    it('parseRewindSseEvent：识别两段回报，形状不符返回 null', () => {
        expect(parseRewindSseEvent({ type: 'rewound-truncated', sessionId: 's', deleteFromSeq: 5 }))
            .toEqual({ type: 'rewound-truncated', sessionId: 's', deleteFromSeq: 5 })
        expect(parseRewindSseEvent({ type: 'rewind-completed', sessionId: 's', filesRestored: false, error: 'boom' }))
            .toEqual({ type: 'rewind-completed', sessionId: 's', filesRestored: false, error: 'boom' })
        expect(parseRewindSseEvent({ type: 'message-received' })).toBeNull()
        expect(parseRewindSseEvent({ type: 'rewound-truncated', sessionId: 's', deleteFromSeq: 'x' })).toBeNull()
        expect(parseRewindSseEvent(null)).toBeNull()
    })

    it('ingestRewindSseEvent：truncated 更新进度、completed 落终态、未知事件不消费', () => {
        const sid = 'sess-1'
        useRewindStore.getState().beginRewind(sid, 'u1')

        expect(ingestRewindSseEvent({ type: 'heartbeat' })).toBe(false)
        expect(ingestRewindSseEvent({ type: 'rewound-truncated', sessionId: sid, deleteFromSeq: 7 })).toBe(true)
        expect(useRewindStore.getState().progressBySession.get(sid)?.deleteFromSeq).toBe(7)

        expect(ingestRewindSseEvent({ type: 'rewind-completed', sessionId: sid, filesRestored: false, error: 'io' })).toBe(true)
        expect(useRewindStore.getState().progressBySession.size).toBe(0)
        expect(useRewindStore.getState().completionBySession.get(sid)?.error).toBe('io')
    })
})
