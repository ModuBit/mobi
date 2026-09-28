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
 * 审查视图组件测试（票05/06/07 + 布局重构）：hook 注入假数据，不碰网络。
 * header（范围 Select + 统计）、平铺 Collapse 清单（默认全收起 + 点开懒加载查询）、
 * 空清单态、非 git unavailable 态、单文件查询的两树指针组装、diff 文件树面板开合
 * 与联动。DiffViewer 以桩替换（codemirror 在 jsdom 下无意义）。
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
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import type { GitReviewData, GitReviewFileQuery } from '@mobi/shared'

afterEach(cleanup)

const LAST_TURN: GitReviewData['scopes']['last-turn'] = {
    // 真实不变量：CLI 侧按 path localeCompare 排序——b.ts（根目录）在 src/deep/a.ts 前
    files: [
        { path: 'b.ts', kind: 'add', additions: 4, deletions: 0 },
        { path: 'src/deep/a.ts', kind: 'modify', additions: 5, deletions: 3 },
    ],
    stats: { files: 2, additions: 9, deletions: 3 },
    git: { baseTree: 'a'.repeat(40), headTree: 'b'.repeat(40), turnIndex: 2 },
}
const STAGED: NonNullable<GitReviewData['scopes']['last-turn']> = {
    files: [{ path: 'staged-only.txt', kind: 'modify', additions: 1, deletions: 1 }],
    stats: { files: 1, additions: 1, deletions: 1 },
    git: null,
}
const DATA: GitReviewData = {
    unavailable: false,
    scopes: { 'last-turn': LAST_TURN, uncommitted: STAGED, unstaged: STAGED, staged: STAGED },
}

function makeDeps(overrides: {
    data?: GitReviewData
    error?: string | null
    isLoading?: boolean
    fileDiff?: { before: string | null; after: string | null; patch: string }
    onQuery?: (query: GitReviewFileQuery | null) => void
    running?: boolean | undefined
    refetch?: ReturnType<typeof vi.fn>
}): GitReviewDeps {
    return {
        useReviewData: () => ({ data: overrides.data, error: overrides.error ?? null, isLoading: overrides.isLoading ?? false, updatedAt: 0, refetch: overrides.refetch ?? (() => {}) }),
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
        useSessionRunning: () => overrides.running,
    }
}

/** Collapse 迁移后 aria-expanded 挂在面板头（antd v6）上（头行 label 只承载测试钩子） */
function expandedOf(row: HTMLElement): string | null {
    return row.closest('.ant-collapse-header')?.getAttribute('aria-expanded') ?? null
}

/** 打开范围下拉（antd v6 Select 无 .ant-select-selector，root 即交互入口；选项挂载在打开后的 portal） */
function openScopeDropdown() {
    fireEvent.mouseDown(document.querySelector('.ant-select')!)
}

describe('GitReviewView（hook 注入）', () => {
    it('header 统计 + 清单默认全收起；点开才发起两树查询（懒加载）', () => {
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

        // 默认全收起：无查询、无 diff 渲染
        expect(queries.filter((q) => q !== null)).toHaveLength(0)
        expect(expandedOf(rows[0]!)).toBe('false')
        expect(screen.queryByTestId('diff-viewer-stub')).toBeNull()

        // 点开即发起 last-turn 查询（协议只含 scope+path，两树由 CLI 解析）
        fireEvent.click(rows[0]!)
        const issued = queries.filter((q) => q !== null)
        expect(issued).toHaveLength(1)
        expect(issued[0]).toEqual({ scope: 'last-turn', path: 'b.ts', turnIndex: 2 })
        expect(expandedOf(rows[0]!)).toBe('true')
        expect(screen.getByTestId('diff-viewer-stub').getAttribute('data-before')).toBe('old')
    })

    it('单击另一文件追加展开（多开不互斥；懒加载只对展开行发起查询）', () => {
        const queries: (GitReviewFileQuery | null)[] = []
        render(<GitReviewView sessionId="s1" deps={makeDeps({ data: DATA, fileDiff: { before: '', after: 'new', patch: '' }, onQuery: (q) => queries.push(q) })} />)

        const rows = screen.getAllByTestId('review-file-row')
        // 初始全收起；点开两行 → 多开并存
        fireEvent.click(rows[0]!)
        fireEvent.click(rows[1]!)
        expect(expandedOf(rows[0]!)).toBe('true')
        expect(expandedOf(rows[1]!)).toBe('true')
        expect(queries.at(-1)).toEqual({ scope: 'last-turn', path: 'src/deep/a.ts', turnIndex: 2 })

        // 再点同一行收起，另一行保持展开
        fireEvent.click(rows[1]!)
        expect(expandedOf(rows[1]!)).toBe('false')
        expect(expandedOf(rows[0]!)).toBe('true')
        expect(queries.at(-1)).toEqual({ scope: 'last-turn', path: 'src/deep/a.ts', turnIndex: 2 })
    })

    it('行操作「在标签页中打开」：调 workspaceStore.openFileTab，不冒泡切换展开', () => {
        render(<GitReviewView sessionId="s1" deps={makeDeps({ data: DATA, fileDiff: { before: '', after: '', patch: '' } })} />)
        const rows = screen.getAllByTestId('review-file-row')
        const btn = rows[1]!.querySelector('button[aria-label="review.openInTab"]') as HTMLButtonElement
        fireEvent.click(btn)
        const s = useWorkspaceStore.getState().getSession('s1')
        expect(s.tabs.some((t) => t.mode === 'file' && t.filePath === 'src/deep/a.ts')).toBe(true)
        expect(expandedOf(rows[1]!)).toBe('false')
    })

    it('空清单：提示空态且无文件行', () => {
        const empty: GitReviewData = { ...DATA, scopes: { ...DATA.scopes, 'last-turn': { ...LAST_TURN!, files: [], stats: { files: 0, additions: 0, deletions: 0 } } } }
        render(<GitReviewView sessionId="s1" deps={makeDeps({ data: empty })} />)
        expect(screen.queryByTestId('review-file-row')).toBeNull()
        // 上一轮档空清单：文案区分「无快照变化」与其他档「暂无变更」
        expect(screen.getByText('review.noSnapshotChanges')).toBeDefined()
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

    it('档位切换（受控）：其他档查询不带两树指针，文件列表随档刷新', () => {
        const queries: (GitReviewFileQuery | null)[] = []
        render(
            <GitReviewView
                sessionId="s1"
                scope="staged"
                deps={makeDeps({ data: DATA, fileDiff: { before: 'x', after: 'y', patch: '' }, onQuery: (q) => queries.push(q) })}
            />,
        )
        // staged 档文件清单；点开才查询（无两树指针）
        const rows = screen.getAllByTestId('review-file-row')
        expect(rows).toHaveLength(1)
        fireEvent.click(rows[0]!)
        expect(queries.filter((q) => q !== null)).toEqual([{ scope: 'staged', path: 'staged-only.txt' }])
    })

    it('无快照链：上一轮档在下拉中禁用；内容区诚实空态（不装数据）', () => {
        const noChain: GitReviewData = { ...DATA, scopes: { ...DATA.scopes, 'last-turn': null } }
        render(<GitReviewView sessionId="s1" deps={makeDeps({ data: noChain })} />)
        expect(screen.getAllByText('review.noSnapshot').length).toBeGreaterThanOrEqual(1)

        openScopeDropdown()
        // antd v6 下拉禁用项 class：.ant-select-item-option-disabled
        const disabled = document.querySelector('.ant-select-item-option-disabled')
        expect(disabled).not.toBeNull()
        expect(disabled!.textContent).toContain('review.scope.lastTurn')
    })

    it('重命名（票07）：清单行成对呈现旧名；查询只含 scope+path（旧路径由 CLI 自解析）', () => {
        const renames: GitReviewData = {
            ...DATA,
            scopes: {
                ...DATA.scopes,
                'last-turn': {
                    files: [{ path: 'after.txt', kind: 'rename', additions: 0, deletions: 0, previousPath: 'before.txt' }],
                    stats: { files: 1, additions: 0, deletions: 0 },
                    git: { baseTree: 'a'.repeat(40), headTree: 'b'.repeat(40), turnIndex: 2 },
                },
            },
        }
        const queries: (GitReviewFileQuery | null)[] = []
        render(<GitReviewView sessionId="s1" deps={makeDeps({ data: renames, fileDiff: { before: 'r', after: 'r', patch: '' }, onQuery: (q) => queries.push(q) })} />)

        const row = screen.getByTestId('review-file-row')
        expect(row.textContent).toContain('after.txt')
        expect(row.textContent).toContain('before.txt')
        fireEvent.click(row)
        expect(queries.filter((q) => q !== null)[0]).toEqual({ scope: 'last-turn', path: 'after.txt', turnIndex: 2 })
    })

    it('大 diff（oversize 由 CLI 打标）：降级为「文件过大」+ 跳转文件查看器入口，且不发 diff 查询', () => {
        const big: GitReviewData = {
            ...DATA,
            scopes: {
                ...DATA.scopes,
                'last-turn': {
                    files: [{ path: 'huge.ts', kind: 'modify', additions: 6000, deletions: 0, oversize: true }],
                    stats: { files: 1, additions: 6000, deletions: 0 },
                    git: { baseTree: 'a'.repeat(40), headTree: 'b'.repeat(40), turnIndex: 2 },
                },
            },
        }
        const queries: (GitReviewFileQuery | null)[] = []
        render(<GitReviewView sessionId="s1" deps={makeDeps({ data: big, fileDiff: { before: '', after: '', patch: '' }, onQuery: (q) => queries.push(q) })} />)
        fireEvent.click(screen.getByTestId('review-file-row'))
        expect(screen.getByTestId('review-too-big')).toBeDefined()
        expect(screen.queryByTestId('diff-viewer-stub')).toBeNull()
        expect(queries.filter((q) => q !== null)).toHaveLength(0) // oversize 不发 diff 拉取
        // 点击入口 → 调 workspaceStore.openFileTab（新 file tab 激活）
        fireEvent.click(screen.getByTestId('review-too-big-open').querySelector('button') ?? screen.getByTestId('review-too-big-open'))
        const s = useWorkspaceStore.getState().getSession('s1')
        expect(s.tabs.some((t) => t.mode === 'file' && t.filePath === 'huge.ts')).toBe(true)
    })

    it('非文本条目：整行不可展开（无箭头、点击不发查询不出占位）', () => {
        const withBin: GitReviewData = {
            ...DATA,
            scopes: {
                ...DATA.scopes,
                'last-turn': {
                    files: [
                        { path: '16pic.jpg', kind: 'add', additions: 0, deletions: 0 },
                        { path: 'text.ts', kind: 'modify', additions: 2, deletions: 0 },
                    ],
                    stats: { files: 2, additions: 2, deletions: 0 },
                    git: { baseTree: 'a'.repeat(40), headTree: 'b'.repeat(40), turnIndex: 2 },
                },
            },
        }
        const queries: (GitReviewFileQuery | null)[] = []
        render(<GitReviewView sessionId="s1" deps={makeDeps({ data: withBin, fileDiff: { before: '', after: 'x', patch: '' }, onQuery: (q) => queries.push(q) })} />)

        // 点开图片行：行不可展开——无查询、无 diff、无展开箭头
        const rows = screen.getAllByTestId('review-file-row')
        fireEvent.click(rows[0]!)
        expect(queries.filter((q) => q !== null)).toHaveLength(0)
        expect(expandedOf(rows[0]!)).toBe('false')
        expect(rows[0]!.querySelector('.review-row-chevron')).toBeNull()
        expect(screen.queryByTestId('diff-viewer-stub')).toBeNull()

        // 文本行照常发查询
        fireEvent.click(rows[1]!)
        expect(queries.at(-1)).toEqual({ scope: 'last-turn', path: 'text.ts', turnIndex: 2 })
    })

    it('diff 文件树面板：开合按钮显隐；点叶节点联动主列表展开对应行', () => {
        const queries: (GitReviewFileQuery | null)[] = []
        render(<GitReviewView sessionId="s1" deps={makeDeps({ data: DATA, fileDiff: { before: '', after: '', patch: '' }, onQuery: (q) => queries.push(q) })} />)

        expect(screen.queryByTestId('review-tree-panel')).toBeNull()
        fireEvent.click(screen.getByTestId('review-tree-toggle'))
        expect(screen.getByTestId('review-tree-panel')).toBeDefined()

        // 树按目录层级呈现：deep 目录 + 叶节点（默认全展开）
        expect(screen.getByText('deep')).toBeDefined()
        const panel = screen.getByTestId('review-tree-panel')
        // 叶节点标题含 kind 徽标字（textContent = 'Ma.ts'），按尾段匹配
        const leaf = [...panel.querySelectorAll('.ant-tree-title')].find((el) => (el.textContent ?? '').endsWith('a.ts'))!
        fireEvent.click(leaf.closest('.ant-tree-node-content-wrapper') ?? leaf)
        const rows = screen.getAllByTestId('review-file-row')
        const target = rows.find((r) => r.getAttribute('data-path') === 'src/deep/a.ts')!
        expect(expandedOf(target)).toBe('true')
        expect(queries.at(-1)).toEqual({ scope: 'last-turn', path: 'src/deep/a.ts', turnIndex: 2 })
    })
})
