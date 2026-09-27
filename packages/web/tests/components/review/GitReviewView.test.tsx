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
 * 审查视图组件测试（票05）：hook 注入假数据，不碰网络。清单渲染/统计/目录分组、
 * 文件切换（含默认选中）、空清单态、非 git unavailable 态、单文件查询的
 * 两树指针组装。DiffViewer 以桩替换（codemirror 在 jsdom 下无意义）。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

vi.mock('react-i18next', async (orig) => {
    const actual = await orig()
    return {
        ...actual,
        useTranslation: () => ({ t: (k: string, opts?: { count?: number }) =>
            k === 'review.fileCount' ? `${opts?.count} 个文件` : k }),
    }
})
vi.mock('@/components/review/DiffViewer', () => ({
    DiffViewer: ({ before, after }: { before: string; after: string }) => (
        <div data-testid="diff-viewer-stub" data-before={before} data-after={after} />
    ),
}))

import { GitReviewView, type GitReviewDeps } from '@/components/review/GitReviewView'
import type { GitReviewData, GitReviewFileQuery } from '@mobi/shared'

afterEach(cleanup)

const SCOPE: GitReviewData['scopes']['last-turn'] = {
    // 真实不变量：CLI 侧按 path localeCompare 排序——b.ts（根目录）在 src/deep/a.ts 前
    files: [
        { path: 'b.ts', kind: 'add', additions: 4, deletions: 0 },
        { path: 'src/deep/a.ts', kind: 'modify', additions: 5, deletions: 3 },
    ],
    stats: { files: 2, additions: 9, deletions: 3 },
    git: { baseTree: 'a'.repeat(40), headTree: 'b'.repeat(40) },
}
const DATA: GitReviewData = {
    unavailable: false,
    scopes: { 'last-turn': SCOPE, uncommitted: null as never, unstaged: null as never, staged: null as never },
}

function makeDeps(overrides: {
    data?: GitReviewData
    error?: string | null
    isLoading?: boolean
    fileDiff?: { before: string | null; after: string | null; patch: string }
    onQuery?: (query: GitReviewFileQuery | null) => void
}): GitReviewDeps {
    return {
        useReviewData: () => ({ data: overrides.data, error: overrides.error ?? null, isLoading: overrides.isLoading ?? false, refetch: () => {} }),
        useFileDiff: (_sessionId: string, query: GitReviewFileQuery | null) => {
            overrides.onQuery?.(query)
            return {
                data: overrides.fileDiff
                    ? { patch: overrides.fileDiff.patch, before: overrides.fileDiff.before, after: overrides.fileDiff.after }
                    : undefined,
                error: null,
                isLoading: false,
            }
        },
    }
}

describe('GitReviewView（hook 注入）', () => {
    it('清单渲染：统计行 + 目录分组 + kind 徽标；默认选中首个文件并发起两树查询', () => {
        const queries: (GitReviewFileQuery | null)[] = []
        render(<GitReviewView sessionId="s1" deps={makeDeps({ data: DATA, fileDiff: { before: 'old', after: 'new', patch: '' }, onQuery: (q) => queries.push(q) })} />)

        expect(screen.getByTestId('git-review-view')).toBeDefined()
        expect(screen.getByText('review.scope.lastTurn')).toBeDefined()
        expect(screen.getByText('2 个文件')).toBeDefined()
        const rows = screen.getAllByTestId('review-file-row')
        expect(rows).toHaveLength(2)
        expect(rows[0]!.textContent).toContain('b.ts')
        expect(rows[1]!.textContent).toContain('src/deep/')
        expect(rows[1]!.textContent).toContain('a.ts')

        // 默认选中首个文件：effect 首帧 null（未选）→ 选中后带两树指针的 last-turn 查询
        const issued = queries.filter((q) => q !== null)
        expect(issued).toHaveLength(1)
        expect(issued[0]).toEqual({ scope: 'last-turn', path: 'b.ts', baseTree: 'a'.repeat(40), headTree: 'b'.repeat(40) })
        expect(screen.getByTestId('diff-viewer-stub').getAttribute('data-before')).toBe('old')
    })

    it('点击另一文件切换 diff（目录分组不影响行定位）', () => {
        const queries: (GitReviewFileQuery | null)[] = []
        render(<GitReviewView sessionId="s1" deps={makeDeps({ data: DATA, fileDiff: { before: '', after: 'new', patch: '' }, onQuery: (q) => queries.push(q) })} />)

        const rows = screen.getAllByTestId('review-file-row')
        fireEvent.click(rows[1]!)
        expect(queries.at(-1)).toEqual({ scope: 'last-turn', path: 'src/deep/a.ts', baseTree: 'a'.repeat(40), headTree: 'b'.repeat(40) })
    })

    it('空清单：提示空态且无文件行', () => {
        const empty: GitReviewData = { ...DATA, scopes: { ...DATA.scopes, 'last-turn': { ...SCOPE!, files: [], stats: { files: 0, additions: 0, deletions: 0 } } } }
        render(<GitReviewView sessionId="s1" deps={makeDeps({ data: empty })} />)
        expect(screen.queryByTestId('review-file-row')).toBeNull()
        expect(screen.getByText('review.empty')).toBeDefined()
    })

    it('非 git 目录：unavailable 诚实空态，不渲染清单', () => {
        render(<GitReviewView sessionId="s1" deps={makeDeps({ data: { ...DATA, unavailable: true } })} />)
        expect(screen.queryByTestId('review-file-row')).toBeNull()
        expect(screen.getByText('review.unavailable')).toBeDefined()
    })

    it('拉数失败：错误文案替代清单', () => {
        render(<GitReviewView sessionId="s1" deps={makeDeps({ error: 'boom' })} />)
        expect(screen.getByText('boom')).toBeDefined()
    })
})
