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

import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useFileListing } from '@/components/composer/useFileListing'
import type { CapabilityTarget, ListDirectoryFn, SearchFilesFn } from '@/core/data/hooks/queries/useDirectoryCapabilities'

const target: CapabilityTarget = { kind: 'machine', machineId: 'm1', cwd: '/home/u' }

/** searchFiles 占位（mention 走 listDirectory 通道，searchFiles 仅需非 null 通过 effect 守卫） */
const searchFn = vi.fn(async () => ({ data: { success: true, entries: [] } })) as unknown as SearchFilesFn

/** 构造可控的 listDirectory mock：prefix 空返回全集，prefix 非空返回匹配子集 */
function makeListFn(all: Array<{ name: string; type: 'file' | 'directory' }>, matched: Array<{ name: string; type: 'file' | 'directory' }>) {
    return vi.fn(async (_path: string, prefix?: string) => ({
        data: {
            success: true,
            entries: (prefix ? matched : all).map((e) => ({ name: e.name, type: e.type })),
        },
    })) as unknown as ListDirectoryFn
}

describe('useFileListing — prefix 下推（两阶段缓存）', () => {
    it('prefix 非空且缓存无匹配 → fallback 带 prefix 请求服务端捞回', async () => {
        // 全集只有 a0/a1/a2（模拟 MAX_RESULTS 截断后不含 workspace）
        const listFn = makeListFn(
            Array.from({ length: 3 }, (_, i) => ({ name: `a${i}`, type: 'directory' as const })),
            [{ name: 'workspace', type: 'directory' as const }],
        )

        const { rerender, result } = renderHook(
            ({ input }) => useFileListing(searchFn, listFn, target, input),
            { initialProps: { input: { mentionInput: '~/', workingDir: '/home/u' } } },
        )

        // 先发全集请求并缓存
        await waitFor(() => expect(listFn).toHaveBeenCalledWith('~', '', expect.anything()))
        await waitFor(() => expect(result.current.items.length).toBe(3))

        // 切到 prefix 非空，且全集缓存里无匹配 → fallback 带 prefix 请求
        rerender({ input: { mentionInput: '~/workspace', workingDir: '/home/u' } })
        await waitFor(() => expect(listFn).toHaveBeenCalledWith('~', 'workspace', expect.anything()))
        await waitFor(() => expect(result.current.items.some((i) => i.label === 'workspace')).toBe(true))
    })

    it('prefix 非空且缓存有匹配 → 用缓存前端过滤，不再请求', async () => {
        const listFn = makeListFn(
            [
                { name: 'docs', type: 'directory' as const },
                { name: 'a1', type: 'directory' as const },
            ],
            [{ name: 'docs', type: 'directory' as const }],
        )

        const { rerender, result } = renderHook(
            ({ input }) => useFileListing(searchFn, listFn, target, input),
            { initialProps: { input: { mentionInput: '~/', workingDir: '/home/u' } } },
        )

        // 全集请求一次
        await waitFor(() => expect(listFn).toHaveBeenCalledTimes(1))

        // prefix=docs 命中缓存（docs 在全集内）→ 不再请求
        rerender({ input: { mentionInput: '~/docs', workingDir: '/home/u' } })
        await waitFor(() => expect(result.current.items.some((i) => i.label === 'docs')).toBe(true))
        // 仍只请求过 1 次（全集），未 fallback
        expect(listFn).toHaveBeenCalledTimes(1)
    })
})
