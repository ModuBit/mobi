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

/**
 * useSendMessage 单元测试
 * 验证乐观更新注入 store、localId 共享、失败时 fetchLatestMessages、分段序列化直传 blocks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { DecryptedMessage } from '@/core/data/api/types'

// fetchLatestMessages 走网络，测试用 spy 替换；appendOptimisticMessage 保留真实以验证 store 状态
const mocks = vi.hoisted(() => ({
    send: vi.fn(),
    fetchLatest: vi.fn(),
}))
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => ({ messages: { send: mocks.send } }),
}))
vi.mock('@/core/data/stores/messageWindowStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/core/data/stores/messageWindowStore')>()
    return {
        ...actual,
        fetchLatestMessages: mocks.fetchLatest,
    }
})

import { useSendMessage } from '@/core/data/hooks/mutations/useSendMessage'
import {
    appendOptimisticMessage,
    getMessageWindowState,
    _resetForTest,
} from '@/core/data/stores/messageWindowStore'

const SESSION_ID = 's1'

/** QueryClientProvider wrapper（useMutation 需要 QueryClient 上下文） */
function makeWrapper(qc: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    }
}

/** 读取 store 中的消息列表 */
function readStoreMessages(): DecryptedMessage[] {
    return getMessageWindowState(SESSION_ID).messages
}

const textOnly = (text: string) => ({ text, files: [], images: [], quotes: [] })

describe('useSendMessage', () => {
    let qc: QueryClient

    beforeEach(() => {
        qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        _resetForTest()
        mocks.send.mockReset()
        mocks.fetchLatest.mockReset()
        // 抑制 hook 内 DEV console.log / onError console.error
        vi.spyOn(console, 'log').mockImplementation(() => {})
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.restoreAllMocks()
        cleanup()
    })

    it('isRunning=false 时 onMutate 注入乐观消息 status=sending', async () => {
        mocks.send.mockResolvedValue({ data: {} })

        const { result } = renderHook(() => useSendMessage(SESSION_ID, false), {
            wrapper: makeWrapper(qc),
        })

        await act(async () => {
            result.current.mutate(textOnly('hello'))
        })
        await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))

        const msgs = readStoreMessages()
        expect(msgs).toHaveLength(1)
        const optimistic = msgs[0]
        expect(optimistic.status).toBe('sending')
        // 非排队轨道（lifecycle=null）时 lifecycleAt 恒 null——shared 契约不变量，
        // 携带伪时间戳会让后续按 lifecycleAt 判时间序的消费点读到与 positionAt 不一致的值
        expect(optimistic.lifecycleAt).toBeNull()
        // 非 running 发送 → 不进排队轨道
        expect(optimistic.lifecycle).toBeNull()
        // 乐观消息 id === localId
        expect(optimistic.id).toBe(optimistic.localId)
        // content 信封持 blocks 数组（与 hub 落库同构）
        const content = optimistic.content as {
            role: string
            content: Array<{ type: string; text: string }>
            meta: { sentFrom: string }
        }
        expect(content.role).toBe('user')
        expect(content.content).toEqual([{ type: 'text', text: 'hello' }])
        expect(content.meta.sentFrom).toBe('webapp')
    })

    it('isRunning=true 时乐观消息 status=queued', async () => {
        mocks.send.mockResolvedValue({ data: {} })

        const { result } = renderHook(() => useSendMessage(SESSION_ID, true), {
            wrapper: makeWrapper(qc),
        })

        await act(async () => {
            result.current.mutate(textOnly('排队中'))
        })
        await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))

        const msgs = readStoreMessages()
        expect(msgs[0].status).toBe('queued')
        // running 中发送 → 进排队轨道（lifecycle='queued'），lifecycleAt = created_at（hub 契约不变量）
        expect(msgs[0].lifecycle).toBe('queued')
        expect(msgs[0].lifecycleAt).toBe(msgs[0].createdAt)
    })

    it('mutate(segments) 生成的 localId 被 onMutate 与 mutationFn 共享', async () => {
        mocks.send.mockResolvedValue({ data: {} })

        const { result } = renderHook(() => useSendMessage(SESSION_ID, false), {
            wrapper: makeWrapper(qc),
        })

        await act(async () => {
            result.current.mutate(textOnly('shared-id'))
        })
        await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))

        // mutationFn 收到的 localId（第三参数）
        const sentLocalId = mocks.send.mock.calls[0][2]
        expect(sentLocalId).toBeTruthy()
        expect(typeof sentLocalId).toBe('string')

        // store 中乐观消息的 id / localId 与之一致
        const msgs = readStoreMessages()
        const optimistic = msgs[0]
        expect(optimistic.localId).toBe(sentLocalId)
        expect(optimistic.id).toBe(sentLocalId)
    })

    it('乐观消息追加到 store 末尾，保留已有消息', async () => {
        mocks.send.mockResolvedValue({ data: {} })
        const existing: DecryptedMessage = {
            id: 'msg-existing',
            seq: 1,
            localId: null,
            createdAt: 1000,
            content: { role: 'user', content: 'old' },
        } as unknown as DecryptedMessage
        appendOptimisticMessage(SESSION_ID, existing)

        const { result } = renderHook(() => useSendMessage(SESSION_ID, false), {
            wrapper: makeWrapper(qc),
        })

        await act(async () => {
            result.current.mutate(textOnly('new one'))
        })
        await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))

        const msgs = readStoreMessages()
        expect(msgs).toHaveLength(2)
        // 原有消息保持在前
        expect(msgs[0].id).toBe('msg-existing')
        // 乐观消息在末尾
        expect(msgs[1].id).toBe(msgs[1].localId)
    })

    it('分段输入序列化为 blocks 数组直传 api.messages.send', async () => {
        mocks.send.mockResolvedValue({ data: {} })

        const { result } = renderHook(() => useSendMessage(SESSION_ID, false), {
            wrapper: makeWrapper(qc),
        })

        await act(async () => {
            result.current.mutate({
                text: '帮我看看',
                files: [{ id: 'f1', filename: 'r.pdf', path: '/u/r.pdf', mimeType: 'application/pdf', size: 5 }],
                images: [],
                quotes: [],
            })
        })
        await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))

        // body 第 2 参为 blocks：固定顺序 document → text
        const blocks = mocks.send.mock.calls[0][1] as Array<Record<string, unknown>>
        expect(blocks).toEqual([
            { type: 'document', source: { type: 'url', value: '/u/r.pdf', mimeType: 'application/pdf' }, id: 'f1', filename: 'r.pdf', size: 5 },
            { type: 'text', text: '帮我看看' },
        ])
    })

    it('send opts 的 formState 进入 api.messages.send 第 4 参（表单快照票 02——E2E 实锤 send() 组装曾丢失该字段）', async () => {
        mocks.send.mockResolvedValue({ data: {} })

        const { result } = renderHook(() => useSendMessage(SESSION_ID, false), {
            wrapper: makeWrapper(qc),
        })

        await act(async () => {
            result.current.mutate(textOnly('界面触发'), {
                sentFrom: 'openui',
                sourceBlock: 'anchor-1',
                formState: { $actionState: 'idle', answers: { a: true } },
            })
        })
        await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))

        expect(mocks.send.mock.calls[0][3]).toEqual({
            sentFrom: 'openui',
            sourceBlock: 'anchor-1',
            formState: { $actionState: 'idle', answers: { a: true } },
        })
    })

    it('send opts 的 stateVar 进入 api.messages.send 第 4 参（per-action 票 02——组装层逐字段锁）', async () => {
        mocks.send.mockResolvedValue({ data: {} })

        const { result } = renderHook(() => useSendMessage(SESSION_ID, false), {
            wrapper: makeWrapper(qc),
        })

        await act(async () => {
            result.current.mutate(textOnly('界面触发'), {
                sentFrom: 'openui',
                sourceBlock: 'anchor-1',
                stateVar: '$mdState',
            })
        })
        await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))

        expect(mocks.send.mock.calls[0][3]).toEqual({
            sentFrom: 'openui',
            sourceBlock: 'anchor-1',
            stateVar: '$mdState',
        })
    })

    it('openui 乐观气泡 meta 携带 openuiStateVar/openuiFormState（per-action E2E 2026-10-11 实锤——echo 合并不回填 meta，缺了 derive 按「无身份」配对写裸键，复合键 running 永不被终态覆盖）', async () => {
        mocks.send.mockResolvedValue({ data: {} })

        const { result } = renderHook(() => useSendMessage(SESSION_ID, false), {
            wrapper: makeWrapper(qc),
        })

        const formState = { '$todos': { task1: true } }
        await act(async () => {
            result.current.mutate(textOnly('界面触发'), {
                sentFrom: 'openui',
                sourceBlock: 'blk-7:1:0',
                stateVar: '$mdState',
                formState,
            })
        })
        await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))

        const optimistic = readStoreMessages()[0]
        const meta = (optimistic.content as { meta: Record<string, unknown> }).meta
        expect(meta.sentFrom).toBe('openui')
        expect(meta.openuiAnchor).toBe('blk-7:1:0')
        expect(meta.openuiStateVar).toBe('$mdState')
        expect(meta.openuiFormState).toBe(formState)
    })

    it('手打消息的乐观气泡 meta 不带 openui 字段（资格只认 openui 来源）', async () => {
        mocks.send.mockResolvedValue({ data: {} })

        const { result } = renderHook(() => useSendMessage(SESSION_ID, false), {
            wrapper: makeWrapper(qc),
        })

        await act(async () => {
            result.current.mutate(textOnly('手打'), {
                sentFrom: 'webapp',
                sourceBlock: 'blk-7:1:0',
                stateVar: '$mdState',
            })
        })
        await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))

        const meta = (readStoreMessages()[0].content as { meta: Record<string, unknown> }).meta
        expect(meta.openuiAnchor).toBeUndefined()
        expect(meta.openuiStateVar).toBeUndefined()
        expect(meta.openuiFormState).toBeUndefined()
    })

    it('onError 时调用 fetchLatestMessages(api, sessionId)', async () => {
        mocks.send.mockRejectedValue(new Error('network down'))

        const { result } = renderHook(() => useSendMessage(SESSION_ID, false), {
            wrapper: makeWrapper(qc),
        })

        await act(async () => {
            result.current.mutate(textOnly('will-fail'))
        })
        await waitFor(() => expect(result.current.isError).toBe(true))

        expect(mocks.fetchLatest).toHaveBeenCalledTimes(1)
        // 第二参数是 sessionId
        expect(mocks.fetchLatest.mock.calls[0][1]).toBe(SESSION_ID)
    })
})
