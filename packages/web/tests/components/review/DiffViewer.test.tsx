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
 * DiffViewer（票07 @pierre/diffs 换血）props→options 映射边界单测：
 * layout/wrap → 库 options、空 patch 守卫降级、hydration 返回形状收敛。
 * 渲染本体不测（信任库，PoC 已验）——PatchDiff 以桩替换捕获 props。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DiffTarget } from '@mobi/shared'

// PatchDiff 桩：捕获 props 供断言（不渲染 web component）
const captured: Array<{ patch: string; options: Record<string, unknown> }> = []
vi.mock('@pierre/diffs/react', () => ({
    PatchDiff: ({ patch, options }: { patch: string; options: Record<string, unknown> }) => {
        captured.push({ patch, options })
        return <div data-testid="patch-diff-stub" />
    },
}))
// pierreTheme 预热 side effect 在 jsdom 无意义，桩掉
vi.mock('@/components/review/pierreTheme', () => ({ PIERRE_BRIDGE_VARS: {} }))

import { DiffViewer } from '@/components/review/DiffViewer'

afterEach(() => {
    cleanup()
    captured.length = 0
})

const TARGET: DiffTarget = { kind: 'worktree', area: 'uncommitted' }
const TURN_TARGET: DiffTarget = { kind: 'turn' }

function renderViewer(overrides: Partial<Parameters<typeof DiffViewer>[0]> = {}, patch: string | null = 'diff --git a/x b/x', target: DiffTarget = TARGET) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        // 直接预置 patch 查询缓存（免 mock api 层）；载荷是 {data}|{error} 包装
        // （与 makeReviewPatchQueryFn 同形——同键异形曾致静默空分支，见该函数注释）
        if (patch !== null) {
            client.setQueryData(['git-review-v2-patch', 's1', JSON.stringify(target), 'x.ts', ''], { data: { patch, previousPath: null, oversized: false, binary: false } })
        }
    return render(
        <QueryClientProvider client={client}>
            <DiffViewer
                sessionId="s1"
                target={target}
                path="x.ts"
                version=""
                wrap
                layout="unified"
                {...overrides}
            />
        </QueryClientProvider>,
    )
}

describe('DiffViewer（pierre 换血）', () => {
    it('有 patch：渲染 PatchDiff，props→options 映射（unified + wrap）', () => {
        renderViewer()
        const stub = screen.getByTestId('patch-diff-stub')
        expect(stub).toBeDefined()
        const { options } = captured[0]!
        expect(options.diffStyle).toBe('unified')
        expect(options.overflow).toBe('wrap')
        expect(options.hunkSeparators).toBe('line-info')
        expect(options.disableFileHeader).toBe(true)
        expect(typeof options.loadDiffFiles).toBe('function')
    })

    it('split + 关 wrap：options 映射跟随（scroll 横滚）', () => {
        renderViewer({ layout: 'split', wrap: false })
        const { options } = captured[0]!
        expect(options.diffStyle).toBe('split')
        expect(options.overflow).toBe('scroll')
    })

    it('turn 档：不配 loadDiffFiles（归档只存统计+patch，全文零进盘——零 RPC）', () => {
        renderViewer({}, 'diff --git a/x b/x', TURN_TARGET)
        const { options } = captured[0]!
        expect(options.loadDiffFiles).toBeUndefined()
    })

    it('空 patch：不渲染 PatchDiff（空串会 throw，PoC 实证），降级 noDiff 文案', () => {
        renderViewer({}, '')
        expect(screen.queryByTestId('patch-diff-stub')).toBeNull()
        expect(screen.getByTestId('git-diff-viewer').textContent).toContain('Diff unavailable')
    })

    it('hydration fetchQuery 键携带 version（与 patch 同代——30s staleTime 窗口内不得命中旧代全文）', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const fetchSpy = vi.spyOn(client, 'fetchQuery').mockResolvedValue({ data: { before: 'b\n', after: 'a\n' } })
        // 预置同代 patch 缓存让 PatchDiff 同步渲染（loadDiffFiles 才会被捕获）
        client.setQueryData(['git-review-v2-patch', 's1', JSON.stringify(TARGET), 'x.ts', '42'], { data: { patch: 'diff --git a/x b/x', previousPath: null, oversized: false, binary: false } })
        render(
            <QueryClientProvider client={client}>
                <DiffViewer sessionId="s1" target={TARGET} path="x.ts" version={42} wrap layout="unified" />
            </QueryClientProvider>,
        )
        const loadDiffFiles = captured[0]!.options.loadDiffFiles as () => Promise<unknown>
        await expect(loadDiffFiles()).resolves.toEqual({
            oldFile: { name: 'x.ts', contents: 'b\n' },
            newFile: { name: 'x.ts', contents: 'a\n' },
        })
        expect(fetchSpy).toHaveBeenCalledTimes(1)
        expect(fetchSpy.mock.calls[0]![0].queryKey).toEqual(['git-review-v2-contents', 's1', JSON.stringify(TARGET), 'x.ts', '42'])
    })
})
