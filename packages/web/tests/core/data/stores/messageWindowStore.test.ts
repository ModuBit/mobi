import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
    getMessageWindowState,
    subscribeMessageWindow,
    clearMessageWindow,
    fetchLatestMessages,
    fetchOlderMessages,
    ingestIncomingMessages,
    appendOptimisticMessage,
    removeOptimisticMessage,
    markMessagesSubmitted,
    updateMessageStatus,
    _resetForTest,
    _internal,
} from '@/core/data/stores/messageWindowStore'
import type { MobiApi } from '@/core/data/api/client'
import type { DecryptedMessage } from '@mobi/shared'
import type { MessageStatus } from '@/core/data/api/types'

// 测试用 api stub：messages.list 返回指定页
function makeApi(pages: { messages: DecryptedMessage[]; page: { hasMore: boolean; nextBeforeSeq: number | null } }[]): MobiApi {
    let callIdx = 0
    return {
        messages: { list: async (_sid: string, _opts: { beforeSeq?: number | null }) => ({ data: pages[callIdx++] }) },
    } as unknown as MobiApi
}

function msg(id: string, seq: number | null): DecryptedMessage {
    return {
        id,
        seq,
        localId: null,
        submittedAt: null,
        queueState: null,
        positionAt: seq ?? 0,
        createdAt: seq ?? 0,
        content: { role: 'user', content: { type: 'text', text: id } },
        snapshot: false,
    } as unknown as DecryptedMessage
}

describe('messageWindowStore 基建', () => {
    beforeEach(() => _resetForTest())

    it('空 session 返回 EMPTY_STATE', () => {
        const s = getMessageWindowState('s1')
        expect(s.messages).toEqual([])
        expect(s.hasMore).toBe(false)
        expect(s.isLoading).toBe(false)
    })

    it('subscribe 收到通知 + 取消订阅后不再通知', () => {
        const listener = vi.fn()
        const unsub = subscribeMessageWindow('s1', listener)
        clearMessageWindow('s1')
        expect(listener).toHaveBeenCalled()
        listener.mockClear()
        unsub()
        clearMessageWindow('s1')
        expect(listener).not.toHaveBeenCalled()
    })

    it('getMessageWindowState 首次访问 auto-create + 二次返回同引用（state 持久）', () => {
        const s1 = getMessageWindowState('s1')
        expect(s1.sessionId).toBe('s1')
        const s2 = getMessageWindowState('s1')
        expect(s2).toBe(s1)
    })

    it('clearMessageWindow 重置 messages/hasMore/isLoading 为空', () => {
        // 先填充 state
        const { updateState, buildState } = _internal
        updateState('s1', prev => buildState(prev, {
            messages: [{ seq: 1, role: 'user', content: 'hi' } as never],
            hasMore: true,
            isLoading: true,
        }))
        // clear 后应回到空
        clearMessageWindow('s1')
        const s = getMessageWindowState('s1')
        expect(s.messages).toEqual([])
        expect(s.hasMore).toBe(false)
        expect(s.isLoading).toBe(false)
        expect(s.isLoadingMore).toBe(false)
        expect(s.oldestSeq).toBeNull()
    })

    it('clearMessageWindow 递增 latestGeneration + olderGeneration', () => {
        const before = _internal.getState('s1')
        expect(before.latestGeneration).toBe(0)
        expect(before.olderGeneration).toBe(0)
        clearMessageWindow('s1')
        const after = _internal.getState('s1')
        expect(after.latestGeneration).toBe(1)
        expect(after.olderGeneration).toBe(1)
        clearMessageWindow('s1')
        const after2 = _internal.getState('s1')
        expect(after2.latestGeneration).toBe(2)
        expect(after2.olderGeneration).toBe(2)
    })

    it('多 session 独立（s1 clear 不影响 s2）', () => {
        const { updateState, buildState } = _internal
        updateState('s1', prev => buildState(prev, { hasMore: true }))
        updateState('s2', prev => buildState(prev, { hasMore: true }))

        clearMessageWindow('s1')

        const s1 = getMessageWindowState('s1')
        const s2 = getMessageWindowState('s2')
        expect(s1.hasMore).toBe(false)
        expect(s2.hasMore).toBe(true)
    })
})

describe('fetchLatest / generation', () => {
    beforeEach(() => _resetForTest())

    it('fetchLatest 首页写入 store + hasMore/oldestSeq', async () => {
        const api = makeApi([{ messages: [msg('a', 3), msg('b', 4)], page: { hasMore: true, nextBeforeSeq: 3 } }])
        await fetchLatestMessages(api, 's1')
        const s = getMessageWindowState('s1')
        expect(s.messages.map(m => m.id)).toEqual(['a', 'b'])
        expect(s.hasMore).toBe(true)
        expect(s.oldestSeq).toBe(3)
        expect(s.isLoading).toBe(false)
    })

    it('过期 fetchLatest 返回不覆盖新 SSE 状态（generation 丢弃）', async () => {
        const api = makeApi([{ messages: [msg('a', 3)], page: { hasMore: false, nextBeforeSeq: null } }])
        const p = fetchLatestMessages(api, 's1')
        // 在 await 期间，SSE 进来一条新消息
        ingestIncomingMessages('s1', [msg('c', 5)])
        await p
        const ids = getMessageWindowState('s1').messages.map(m => m.id)
        expect(ids).toContain('c')
        expect(ids).toContain('a')
    })

    it('fetchLatest 期间 clearMessageWindow 后，旧 fetchLatest 返回被丢弃（generation mismatch）', async () => {
        // 用延迟的 api 让 list 的 await 可控
        let resolveList: (v: { messages: DecryptedMessage[]; page: { hasMore: boolean; nextBeforeSeq: number | null } }) => void = () => {}
        const api = makeApi([{ messages: [msg('a', 3)], page: { hasMore: false, nextBeforeSeq: null } }])
        api.messages.list = async (_sid: string, _opts: { beforeSeq?: number | null }) =>
            new Promise(resolve => { resolveList = (v) => resolve({ data: v }) as never }) as never

        const p = fetchLatestMessages(api, 's1')
        // await 期间 clearMessageWindow（generation 递增 → 旧 fetchLatest 过期）
        clearMessageWindow('s1')
        // 让 fetchLatest 的 await 完成
        resolveList({ messages: [msg('a', 3)], page: { hasMore: false, nextBeforeSeq: null } })
        await p
        // fetchLatest 返回的 [a] 应被丢弃（gen mismatch），store 仍空（clear 后）
        const ids = getMessageWindowState('s1').messages.map(m => m.id)
        expect(ids).not.toContain('a')
    })

    it('首次加载（store 空）fetchLatest 翻 isLoading=true —— 供 ChatContainer 显示 Spin', async () => {
        let resolveList: (v: { messages: DecryptedMessage[]; page: { hasMore: boolean; nextBeforeSeq: number | null } }) => void = () => {}
        const api = makeApi([{ messages: [msg('a', 3)], page: { hasMore: false, nextBeforeSeq: null } }])
        api.messages.list = async () =>
            new Promise(resolve => { resolveList = (v) => resolve({ data: v }) as never }) as never

        const p = fetchLatestMessages(api, 's1')
        // 进行中：store 为空 → isLoading 应翻 true（首次加载语义）
        expect(getMessageWindowState('s1').isLoading).toBe(true)
        resolveList({ messages: [msg('a', 3)], page: { hasMore: false, nextBeforeSeq: null } })
        await p
        expect(getMessageWindowState('s1').isLoading).toBe(false)
    })

    it('重连补拉（store 已有数据）不翻 isLoading —— 防 ChatContainer 早返回循环', async () => {
        // 首次拉首页，store 有数据
        const api = makeApi([
            { messages: [msg('a', 3)], page: { hasMore: false, nextBeforeSeq: null } },
            { messages: [msg('a', 3)], page: { hasMore: false, nextBeforeSeq: null } },
        ])
        await fetchLatestMessages(api, 's1')
        expect(getMessageWindowState('s1').messages).toHaveLength(1)
        expect(getMessageWindowState('s1').isLoading).toBe(false)

        // 第二次 fetchLatest（重连补拉）—— 用延迟 api 让进行中状态可观测
        let resolveList: (v: { messages: DecryptedMessage[]; page: { hasMore: boolean; nextBeforeSeq: number | null } }) => void = () => {}
        api.messages.list = async () =>
            new Promise(resolve => { resolveList = (v) => resolve({ data: v }) as never }) as never

        const p = fetchLatestMessages(api, 's1')
        // 进行中：store 已有数据 → isLoading 不应翻 true（重连补拉静默 merge）
        // 否则 ChatContainer `if (messagesLoading) return <Spin>` 早返回翻转 →
        // ComposerInfoPanel 反复 mount/unmount → 每次 mount 触发 useMessages useEffect →
        // 又调 fetchLatest → isLoading=true → 早返回 → 死循环
        expect(getMessageWindowState('s1').isLoading).toBe(false)
        resolveList({ messages: [msg('a', 3)], page: { hasMore: false, nextBeforeSeq: null } })
        await p
        expect(getMessageWindowState('s1').isLoading).toBe(false)
    })
})

describe('ingestIncomingMessages oldestSeq', () => {
    beforeEach(() => _resetForTest())

    it('SSE 早到空 store 时建立 oldestSeq（首次 ingest 算一次）', () => {
        // 空 store，SSE 早到一条 seq=5 → oldestSeq 应立即建立（不待 fetchLatest）
        ingestIncomingMessages('s1', [msg('a', 5)])
        expect(getMessageWindowState('s1').oldestSeq).toBe(5)
    })

    it('流式期沿用 prev.oldestSeq 不重算（新消息 seq 递增不改变 min）', () => {
        // 首次建立 oldestSeq=5
        ingestIncomingMessages('s1', [msg('a', 5)])
        // 流式追加 seq=10 → min 仍是 5，沿用 prev.oldestSeq（不付 O(n) 重扫）
        ingestIncomingMessages('s1', [msg('b', 10)])
        expect(getMessageWindowState('s1').oldestSeq).toBe(5)
    })
})

describe('queued/optimistic actions', () => {
    beforeEach(() => _resetForTest())

    it('appendOptimisticMessage 追加到末尾 + messagesVersion 递增', () => {
        ingestIncomingMessages('s1', [msg('a', 1)])
        const v0 = getMessageWindowState('s1').messagesVersion
        appendOptimisticMessage('s1', msg('opt', null))
        const s = getMessageWindowState('s1')
        expect(s.messages.map(m => m.id)).toEqual(['a', 'opt'])
        expect(s.messagesVersion).toBe(v0 + 1)
    })

    it('removeOptimisticMessage 按 localId 移除', () => {
        const m = { ...msg('x', null), localId: 'loc-1' } as DecryptedMessage
        appendOptimisticMessage('s1', m)
        removeOptimisticMessage('s1', 'loc-1')
        expect(getMessageWindowState('s1').messages.map(m => m.id)).toEqual([])
    })

    it('markMessagesSubmitted 把命中 localId 翻为 consumed', () => {
        const m = { ...msg('x', null), localId: 'loc-1', queueState: 'pending' as const } as DecryptedMessage
        appendOptimisticMessage('s1', m)
        markMessagesSubmitted('s1', ['loc-1'], 123)
        const r = getMessageWindowState('s1').messages[0]
        expect(r.queueState).toBe('consumed')
        expect(r.submittedAt).toBe(123)
    })

    it('updateMessageStatus 改 status', () => {
        const m = { ...msg('x', null), localId: 'loc-1', status: 'sending' as MessageStatus } as DecryptedMessage
        appendOptimisticMessage('s1', m)
        updateMessageStatus('s1', 'loc-1', 'failed')
        expect(getMessageWindowState('s1').messages[0].status).toBe('failed')
    })
})
