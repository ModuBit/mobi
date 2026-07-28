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
 * useSpawnSession 单元测试
 * 验证 hub 返回的 SpawnResponse 被正确透传：
 * - success → { type:'success', sessionId }
 * - error（HTTP 200，body 含 type:'error'+message）→ { type:'error', message }
 *   （回归：曾无条件标 success、丢弃 message，致 NewSessionPage 仅显示「创建会话失败」兜底文案）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// 隔离 api.machines.spawn，避免真实 HTTP
const mocks = vi.hoisted(() => ({
    spawn: vi.fn(),
}))
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => ({ machines: { spawn: mocks.spawn } }),
}))
// t 仅作兜底文案，返回 key 即可
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}))

import { useSpawnSession } from '@/core/data/hooks/mutations/useSpawnSession'

function makeWrapper(qc: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    }
}

const INPUT = {
    machineId: 'm1',
    directory: '/home/u/proj',
    agent: 'claude' as const,
    model: undefined,
    permissionMode: undefined,
    sessionType: undefined,
    worktreeName: undefined,
    effort: undefined,
}

describe('useSpawnSession', () => {
    let qc: QueryClient

    beforeEach(() => {
        qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        mocks.spawn.mockReset()
    })

    afterEach(() => {
        cleanup()
    })

    it('hub 返回 success 时透传 sessionId', async () => {
        mocks.spawn.mockResolvedValueOnce({ data: { type: 'success', sessionId: 's-1' } })
        const { result } = renderHook(() => useSpawnSession(), { wrapper: makeWrapper(qc) })

        let res: { type: string; sessionId?: string; message?: string } | undefined
        await act(async () => { res = await result.current.spawnSession(INPUT) })

        expect(res?.type).toBe('success')
        expect(res?.sessionId).toBe('s-1')
    })

    it('hub 返回 error（HTTP 200 + body.type=error）时透传 message，而非吞成 success', async () => {
        // hub spawnSession 失败时 return c.json({ type:'error', message }) —— HTTP 仍 200
        // axios 对 200 不抛错，故 useSpawnSession 必须读取 body.type 判定
        mocks.spawn.mockResolvedValueOnce({ data: { type: 'error', message: 'No machine online' } })
        const { result } = renderHook(() => useSpawnSession(), { wrapper: makeWrapper(qc) })

        let res: { type: string; sessionId?: string; message?: string } | undefined
        await act(async () => { res = await result.current.spawnSession(INPUT) })

        expect(res?.type).toBe('error')
        expect(res?.message).toBe('No machine online')
        // 不能退化为 success+undefined sessionId（那会让 NewSessionPage 走兜底「创建会话失败」而丢失真实原因）
        expect(res?.sessionId).toBeUndefined()
    })

    it('hub 返回 shape 异常时给出可读错误（而非 success+undefined）', async () => {
        // 例：machine 离线时 machineRpc 可能返回非预期结构
        mocks.spawn.mockResolvedValueOnce({ data: { unexpected: true } })
        const { result } = renderHook(() => useSpawnSession(), { wrapper: makeWrapper(qc) })

        let res: { type: string; sessionId?: string; message?: string } | undefined
        await act(async () => { res = await result.current.spawnSession(INPUT) })

        expect(res?.type).toBe('error')
        expect(typeof res?.message).toBe('string')
        expect(res?.message.length).toBeGreaterThan(0)
    })

    it('spawn 抛异常时返回 error + 异常信息', async () => {
        mocks.spawn.mockRejectedValueOnce(new Error('Request failed with status code 503'))
        const { result } = renderHook(() => useSpawnSession(), { wrapper: makeWrapper(qc) })

        let res: { type: string; sessionId?: string; message?: string } | undefined
        await act(async () => { res = await result.current.spawnSession(INPUT) })

        expect(res?.type).toBe('error')
        expect(res?.message).toContain('503')
    })
})
