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
    reconcileLatestMessages,
    withdrawFrom,
    removeQueuedMessages,
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
        lifecycleAt: null,
        lifecycle: null,
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

    it('fetchLatest 成功后置 hasFetchedLatest=true（防多消费方 effect 重复触发空会话循环）', async () => {
        // 空会话：messages=[] 但仍置 true（已 fetch 过，不重复）
        const api = makeApi([{ messages: [], page: { hasMore: false, nextBeforeSeq: null } }])
        await fetchLatestMessages(api, 's1')
        expect(getMessageWindowState('s1').hasFetchedLatest).toBe(true)
        // 非空会话同样置 true
        const api2 = makeApi([{ messages: [msg('a', 3)], page: { hasMore: false, nextBeforeSeq: null } }])
        await fetchLatestMessages(api2, 's2')
        expect(getMessageWindowState('s2').hasFetchedLatest).toBe(true)
    })

    it('clearMessageWindow 重置 hasFetchedLatest=false（切回会话重新 fetch）', async () => {
        const api = makeApi([{ messages: [msg('a', 3)], page: { hasMore: false, nextBeforeSeq: null } }])
        await fetchLatestMessages(api, 's1')
        expect(getMessageWindowState('s1').hasFetchedLatest).toBe(true)
        clearMessageWindow('s1')
        expect(getMessageWindowState('s1').hasFetchedLatest).toBe(false)
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

    it('markMessagesSubmitted 把命中 localId 翻为 pushed', () => {
        const m = { ...msg('x', null), localId: 'loc-1', lifecycle: 'queued' as const } as DecryptedMessage
        appendOptimisticMessage('s1', m)
        markMessagesSubmitted('s1', ['loc-1'], 123)
        const r = getMessageWindowState('s1').messages[0]
        expect(r.lifecycle).toBe('pushed')
        expect(r.lifecycleAt).toBe(123)
    })

    it('markMessagesSubmitted 消费后按 positionAt 重排（排队消息跳到 turn 之后）', () => {
        const assistant = (id: string, seq: number, positionAt: number) =>
            ({ ...msg(id, seq), positionAt, lifecycle: null, localId: null } as DecryptedMessage)
        // 运行中发消息：到达顺序 assistant A(100) → 排队 q(150) → assistant B(200)
        ingestIncomingMessages('s1', [assistant('a', 1, 100)])
        appendOptimisticMessage('s1', { ...msg('q', null), positionAt: 150, lifecycle: 'queued' as const, localId: 'loc-q' } as DecryptedMessage)
        ingestIncomingMessages('s1', [assistant('b', 2, 200)])
        expect(getMessageWindowState('s1').messages.map(m => m.id)).toEqual(['a', 'q', 'b'])

        // 消费 q：positionAt 跳变到 999 → 重排到 turn 消息之后，而非卡在 a/b 中间
        markMessagesSubmitted('s1', ['loc-q'], 999)
        expect(getMessageWindowState('s1').messages.map(m => m.id)).toEqual(['a', 'b', 'q'])
    })

    it('updateMessageStatus 改 status', () => {
        const m = { ...msg('x', null), localId: 'loc-1', status: 'sending' as MessageStatus } as DecryptedMessage
        appendOptimisticMessage('s1', m)
        updateMessageStatus('s1', 'loc-1', 'failed')
        expect(getMessageWindowState('s1').messages[0].status).toBe('failed')
    })
})

// ──────────────────────────────────────────────────────────────
// reconcileLatestMessages（rewind 超时对账，M4：以服务端真相替换）
// ──────────────────────────────────────────────────────────────

describe('reconcileLatestMessages（rewind 超时对账）', () => {
    beforeEach(() => _resetForTest())

    it('服务端已删的行从窗口移除（SSE 事件丢失时的本地残留），保留服务端现存行', async () => {
        // 本地窗口有 a(3) b(4) c(5)；Hub 已软删 b/c（SSE 丢了），服务端真相只剩 a
        _internal.updateState('s1', prev => _internal.buildState(prev, {
            messages: [msg('a', 3), msg('b', 4), msg('c', 5)],
            hasFetchedLatest: true,
        }))
        const api = makeApi([{ messages: [msg('a', 3)], page: { hasMore: false, nextBeforeSeq: null } }])

        await reconcileLatestMessages(api, 's1')

        expect(getMessageWindowState('s1').messages.map(m => m.id)).toEqual(['a'])
    })

    it('本地未提交乐观行（sending/queued/failed）保留，不随替换丢失——queued 是运行中排队行，服务端同样无行', async () => {
        const mkOptimistic = (id: string, status: 'sending' | 'queued' | 'failed'): DecryptedMessage => ({
            ...msg(id, null),
            localId: `loc-${id}`,
            status,
        }) as DecryptedMessage
        _internal.updateState('s1', prev => _internal.buildState(prev, {
            messages: [msg('a', 3), mkOptimistic('opt', 'sending'), mkOptimistic('q', 'queued'), mkOptimistic('f', 'failed')],
            hasFetchedLatest: true,
        }))
        const api = makeApi([{ messages: [msg('a', 3)], page: { hasMore: false, nextBeforeSeq: null } }])

        await reconcileLatestMessages(api, 's1')

        const ids = getMessageWindowState('s1').messages.map(m => m.id)
        // 乐观行 seq 为 null 排在服务端行之前；批内相对顺序不依赖（排序锚点相同，稳定性不作保证）
        expect(ids[ids.length - 1]).toBe('a')
        expect([...ids].sort()).toEqual(['a', 'f', 'opt', 'q'])
    })

    it('hasMore 跟随响应更新：旧窗口 hasMore=false 且已加载全量历史，替换后只剩一页 hasMore=true 时不得沿用旧值（否则更早历史永远无法再加载）', async () => {
        _internal.updateState('s1', prev => _internal.buildState(prev, {
            messages: [msg('old', 1), msg('a', 3), msg('b', 4)],
            hasFetchedLatest: true,
            hasMore: false,
        }))
        const api = makeApi([{ messages: [msg('a', 3), msg('b', 4)], page: { hasMore: true, nextBeforeSeq: 3 } }])

        await reconcileLatestMessages(api, 's1')

        const state = getMessageWindowState('s1')
        expect(state.messages.map(m => m.id)).toEqual(['a', 'b'])
        expect(state.hasMore).toBe(true)
    })

    it('对账失败 → 保持现状（不破坏窗口），hasFetchedLatest 仍置位', async () => {
        _internal.updateState('s1', prev => _internal.buildState(prev, {
            messages: [msg('a', 3), msg('b', 4)],
            hasFetchedLatest: true,
        }))
        const api = {
            messages: { list: async () => { throw new Error('network down') } },
        } as unknown as MobiApi

        await reconcileLatestMessages(api, 's1')

        expect(getMessageWindowState('s1').messages.map(m => m.id)).toEqual(['a', 'b'])
        expect(getMessageWindowState('s1').hasFetchedLatest).toBe(true)
    })

    it('对账期间窗口被 clear → 旧响应按 generation 丢弃', async () => {
        _internal.updateState('s1', prev => _internal.buildState(prev, {
            messages: [msg('a', 3)],
            hasFetchedLatest: true,
        }))
        const api = makeApi([{ messages: [msg('stale', 1)], page: { hasMore: false, nextBeforeSeq: null } }])
        const pending = reconcileLatestMessages(api, 's1')
        clearMessageWindow('s1')
        await pending

        expect(getMessageWindowState('s1').messages).toEqual([])
    })
})

describe('withdrawFrom（消息撤回，#53：移除目标行及其后全部，与 hub softDeleteMessagesFrom 无上界对齐）', () => {
    beforeEach(() => _resetForTest())

    it('移除目标 localId 及其后全部行', () => {
        ingestIncomingMessages('s1', [msg('a', 1), msg('b', 2), msg('c', 3), msg('d', 4)])
        withdrawFrom('s1', 'b')
        expect(getMessageWindowState('s1').messages.map(m => m.id)).toEqual(['a'])
    })

    it('命中 id（hub 侧 localId 缺失时以行 id 作锚点）', () => {
        ingestIncomingMessages('s1', [msg('a', 1), msg('b', 2)])
        withdrawFrom('s1', 'a')
        expect(getMessageWindowState('s1').messages.map(m => m.id)).toEqual([])
    })

    it('目标不存在时不移除任何行', () => {
        ingestIncomingMessages('s1', [msg('a', 1), msg('b', 2)])
        withdrawFrom('s1', 'nope')
        expect(getMessageWindowState('s1').messages.map(m => m.id)).toEqual(['a', 'b'])
    })
})

describe('removeQueuedMessages（清队列档批量取消，与 hub 批删同步）', () => {
    beforeEach(() => _resetForTest())

    it('移除全部 lifecycle=queued 行，保留其他 lifecycle', () => {
        ingestIncomingMessages('s1', [
            msg('q1', 1),
            msg('done', 2),
            msg('pushed', 3),
        ])
        _internal.updateState('s1', prev => _internal.buildState(prev, {
            messages: prev.messages.map(m => m.id === 'q1'
                ? { ...m, lifecycle: 'queued' as const }
                : m.id === 'done'
                    ? { ...m, lifecycle: 'done' as const }
                    : { ...m, lifecycle: 'pushed' as const }),
        }))
        removeQueuedMessages('s1')
        expect(getMessageWindowState('s1').messages.map(m => m.id)).toEqual(['done', 'pushed'])
    })

    it('保留 sending/failed 乐观在途行（与 isQueuedInMobi 排除口径一致）', () => {
        ingestIncomingMessages('s1', [msg('a', 1)])
        _internal.updateState('s1', prev => _internal.buildState(prev, {
            messages: [
                ...prev.messages,
                { ...msg('sending', null), lifecycle: 'queued' as const, status: 'sending' as const } as DecryptedMessage,
                { ...msg('failed', null), lifecycle: 'queued' as const, status: 'failed' as const } as DecryptedMessage,
                { ...msg('queued2', null), lifecycle: 'queued' as const } as DecryptedMessage,
            ],
        }))
        removeQueuedMessages('s1')
        expect(getMessageWindowState('s1').messages.map(m => m.id)).toEqual(['a', 'sending', 'failed'])
    })
})

describe('withdrawFrom tombstone（撤回复活防护：迟到广播/snapshot 同 id 重放不复活）', () => {
    beforeEach(() => _resetForTest())

    it('tombstone 命中的行 ingest 不复活，未命中行照常合并', () => {
        ingestIncomingMessages('s1', [msg('a', 1), msg('b', 2), msg('c', 3)])
        withdrawFrom('s1', 'b')
        // 迟到的 acked 行广播：同 id 重新到达 → 跳过
        ingestIncomingMessages('s1', [msg('b', 2)])
        expect(getMessageWindowState('s1').messages.map(m => m.id)).toEqual(['a'])
        // 未命中行照常合并
        ingestIncomingMessages('s1', [msg('d', 4)])
        expect(getMessageWindowState('s1').messages.map(m => m.id)).toEqual(['a', 'd'])
    })

    it('被移除的尾随行同样进 tombstone（软删无上界，迟到达同样不复活）', () => {
        ingestIncomingMessages('s1', [msg('a', 1), msg('b', 2), msg('c', 3)])
        withdrawFrom('s1', 'b')
        ingestIncomingMessages('s1', [msg('c', 3)])
        expect(getMessageWindowState('s1').messages.map(m => m.id)).toEqual(['a'])
    })

    it('fetchLatest 响应含已撤回行时跳过合并（对账防护）', async () => {
        ingestIncomingMessages('s1', [msg('a', 1), msg('b', 2)])
        withdrawFrom('s1', 'b')   // 撤最后一行（及其后无行）——仅 b 进墓碑
        const api = makeApi([{ messages: [msg('a', 1), msg('b', 2)], page: { hasMore: false, nextBeforeSeq: null } }])
        await fetchLatestMessages(api, 's1')
        // 未撤回的 a 照常合并回（响应迟到场景），已撤回的 b 跳过
        expect(getMessageWindowState('s1').messages.map(m => m.id)).toEqual(['a'])
    })

    it('clearMessageWindow 清除 tombstone（会话删除后同 id 新行不再被拦截）', () => {
        ingestIncomingMessages('s1', [msg('a', 1)])
        withdrawFrom('s1', 'a')
        clearMessageWindow('s1')
        ingestIncomingMessages('s1', [msg('a', 1)])
        expect(getMessageWindowState('s1').messages.map(m => m.id)).toEqual(['a'])
    })
})
