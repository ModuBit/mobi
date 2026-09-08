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
 * useFileMeta / useFileContent 错误文案转换：非 2xx 被 axios throw，AxiosError.message
 * 只有笼统的「Request failed with status code N」；回归锁定 queryFn 提取 hub body 的
 * 真实原因（读边界拒绝详情等），meta-error / content-error 态不再吞掉可解释性。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/** 模拟 axios 对非 2xx 抛出的 AxiosError（isAxiosError 探测只认该标志位） */
function axiosLikeError(status: number, body: { success: boolean; error?: string }): Error {
    return Object.assign(new Error(`Request failed with status code ${status}`), {
        isAxiosError: true,
        response: { status, data: body },
    })
}

const fakeApi = {
    files: {
        meta: vi.fn(),
        read: vi.fn(),
    },
}

vi.mock('@/core/data/api/client', async (orig) => {
    const actual = await orig<typeof import('@/core/data/api/client')>()
    return { ...actual, useMobiApi: () => fakeApi }
})

import { useFileMeta, useFileContent } from '@/core/data/hooks/queries/useFileTree'

function Wrapper({ children }: { children: React.ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useFileMeta / useFileContent 错误文案提取', () => {
    beforeEach(() => {
        fakeApi.files.meta.mockReset()
        fakeApi.files.read.mockReset()
    })
    afterEach(cleanup)

    it('meta 403（读边界拒绝）：error.message 为 hub body 的真实原因', async () => {
        fakeApi.files.meta.mockRejectedValue(
            axiosLikeError(403, { success: false, error: "Access denied: Path '~/.claude/settings.json' is in a protected directory" }),
        )
        const { result } = renderHook(() => useFileMeta('s1', '~/x.json'), { wrapper: Wrapper })
        await waitFor(() => expect(result.current.isError).toBe(true))
        expect(result.current.error?.message).toBe(
            "Access denied: Path '~/.claude/settings.json' is in a protected directory",
        )
    })

    it('meta 无 response body error 时回退 AxiosError.message', async () => {
        fakeApi.files.meta.mockRejectedValue(axiosLikeError(500, { success: false }))
        const { result } = renderHook(() => useFileMeta('s1', 'a.txt'), { wrapper: Wrapper })
        await waitFor(() => expect(result.current.isError).toBe(true))
        expect(result.current.error?.message).toBe('Request failed with status code 500')
    })

    it('content 非 2xx：同样提取 hub body 的真实原因', async () => {
        fakeApi.files.read.mockRejectedValue(
            axiosLikeError(403, { success: false, error: 'Access denied: outside readable boundary' }),
        )
        const { result } = renderHook(() => useFileContent('s1', 'a.txt'), { wrapper: Wrapper })
        await waitFor(() => expect(result.current.isError).toBe(true))
        expect(result.current.error?.message).toBe('Access denied: outside readable boundary')
    })
})
