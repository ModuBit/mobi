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
import {
    maybePublishLiveNotice,
    useLiveNoticeStore,
    _resetForTest,
} from '@/core/data/stores/liveNoticeStore'
import { ingestIncomingMessages, getMessageWindowState, _resetForTest as resetWindowStore } from '@/core/data/stores/messageWindowStore'
import type { DecryptedMessage } from '@mobi/shared'

/** informational DecryptedMessage（raw 形状，与 CLI 落库/透传一致） */
function informationalMsg(id: string, level: string, preventContinuation = false): DecryptedMessage {
    return {
        id,
        seq: 1,
        localId: null,
        lifecycle: null,
        lifecycleAt: null,
        positionAt: 1,
        createdAt: 1,
        content: {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'system',
                    subtype: 'informational',
                    content: 'Model fallback engaged: quota exceeded',
                    level,
                    ...(preventContinuation ? { prevent_continuation: true } : {}),
                },
            },
        },
        snapshot: false,
    } as unknown as DecryptedMessage

}

function plainAgentMsg(id: string): DecryptedMessage {
    return {
        id,
        seq: 1,
        localId: null,
        lifecycle: null,
        lifecycleAt: null,
        positionAt: 1,
        createdAt: 1,
        content: {
            role: 'agent',
            content: { type: 'output', data: { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } } },
        },
        snapshot: false,
    } as unknown as DecryptedMessage
}

const getNotice = (sessionId: string) => useLiveNoticeStore.getState().noticeBySession.get(sessionId)

describe('maybePublishLiveNotice 发布判据（02 票：warning 且非阻断继续才走横幅）', () => {
    beforeEach(() => _resetForTest())

    it.each(['info', 'notice', 'suggestion'])('level=%s 完全静默不发布', (level) => {
        maybePublishLiveNotice('s1', informationalMsg('m1', level))
        expect(getNotice('s1')).toBeUndefined()
    })

    it('level=warning 发布（content 原文透传）', () => {
        maybePublishLiveNotice('s1', informationalMsg('m1', 'warning'))
        const notice = getNotice('s1')
        expect(notice?.id).toBe('m1')
        expect(notice?.content).toBe('Model fallback engaged: quota exceeded')
        expect(typeof notice?.createdAt).toBe('number')
    })

    it('prevent_continuation=true 不发布（走流内回放渲染通道）', () => {
        maybePublishLiveNotice('s1', informationalMsg('m1', 'warning', true))
        expect(getNotice('s1')).toBeUndefined()
    })

    it('非 informational 的 agent 消息不发布', () => {
        maybePublishLiveNotice('s1', plainAgentMsg('m1'))
        expect(getNotice('s1')).toBeUndefined()
    })

    it('同会话重复发布覆盖（单 slot，最新胜出）', () => {
        maybePublishLiveNotice('s1', informationalMsg('m1', 'warning'))
        useLiveNoticeStore.getState().publishLiveNotice('s1', { id: 'm2', content: 'second' })
        expect(getNotice('s1')?.id).toBe('m2')
    })
})

describe('liveNoticeStore slot 语义', () => {
    beforeEach(() => _resetForTest())

    it('dismiss 清除该会话 slot，不影响其他会话', () => {
        useLiveNoticeStore.getState().publishLiveNotice('s1', { id: 'a', content: 'x' })
        useLiveNoticeStore.getState().publishLiveNotice('s2', { id: 'b', content: 'y' })
        useLiveNoticeStore.getState().dismissLiveNotice('s1')
        expect(getNotice('s1')).toBeUndefined()
        expect(getNotice('s2')?.id).toBe('b')
    })

    it('dismiss 不存在的会话是 no-op', () => {
        useLiveNoticeStore.getState().dismissLiveNotice('nope')
        expect(useLiveNoticeStore.getState().noticeBySession.size).toBe(0)
    })
})

describe('ingestIncomingMessages 闸门集成（实时到达发布 / backfill 重播不发布）', () => {
    beforeEach(() => {
        _resetForTest()
        resetWindowStore()
    })

    it('SSE 实时到达的 warning informational：发布横幅且消息照常入库', () => {
        ingestIncomingMessages('s1', [informationalMsg('m1', 'warning')])
        expect(getNotice('s1')?.id).toBe('m1')
        expect(getMessageWindowState('s1').messages.map(m => m.id)).toContain('m1')
    })

    it('backfill 重播（历史行回放）不发布——刷新即消失的保证点', () => {
        // 先让消息已在窗口（backfill 只 merge 已在窗口的行）
        ingestIncomingMessages('s1', [informationalMsg('m1', 'warning')])
        useLiveNoticeStore.getState().dismissLiveNotice('s1')
        ingestIncomingMessages('s1', [informationalMsg('m1', 'warning')], { backfill: true })
        expect(getNotice('s1')).toBeUndefined()
    })
})
