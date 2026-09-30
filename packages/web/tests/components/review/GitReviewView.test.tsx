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
 * 审查视图组件测试（审查重写 v2 票05，行为等价迁移）：hook 注入假数据，不碰网络。
 * header（目标 Select + 统计）、平铺 Collapse 清单（默认全收起 + 点开懒加载查询）、
 * 空清单态、逐档不可用态、单文件 patch/contents 查询、diff 文件树面板开合与联动。
 * DiffViewer 以桩替换（pierre/codemirror 在 jsdom 下无意义）。
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
    DiffViewer: ({ path, layout }: { path: string; layout: string }) => (
        <div data-testid="diff-viewer-stub" data-path={path} data-layout={layout} />
    ),
}))

import { GitReviewView, type GitReviewDeps } from '@/components/review/GitReviewView'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import type { DiffTarget, ReviewCommit, ReviewFileEntry, ReviewOverview } from '@mobi/shared'

afterEach(cleanup)

/** ReviewFileEntry 组装（补默认字段，测试只写关心的维度） */
function entry(partial: Partial<ReviewFileEntry> & { path: string }): ReviewFileEntry {
    return {
        previousPath: null,
        kind: 'modify',
        additions: 1,
        deletions: 0,
        binary: false,
        untracked: false,
        oversized: false,
        ...partial,
    }
}

const TURN_FILES: ReviewFileEntry[] = [
    // 真实不变量：CLI 侧按 path localeCompare 排序——b.ts（根目录）在 src/deep/a.ts 前
    entry({ path: 'b.ts', kind: 'add', additions: 4, deletions: 0 }),
    entry({ path: 'src/deep/a.ts', additions: 5, deletions: 3 }),
]
const STAGED_FILES: ReviewFileEntry[] = [entry({ path: 'staged-only.txt', additions: 1, deletions: 1 })]

const COMMITS: ReviewCommit[] = [
    { sha: 'aaaaaaa444444444444444444444444444444444', parentSha: 'bbbbbbb444444444444444444444444444444444', subject: 'feat: add login flow', authorName: 'A', authorTimestamp: 1759000000 },
    { sha: 'ccccccc444444444444444444444444444444444', parentSha: null, subject: 'chore: initial commit', authorName: 'A', authorTimestamp: 1758900000 },
]

const OVERVIEW: ReviewOverview = {
    unavailableScopes: { turn: false, uncommitted: false, unstaged: false, staged: false, commit: false },
    isGitRepository: true,
    scopes: {
        turn: { fileCount: 2, additions: 9, deletions: 3 },
        uncommitted: { fileCount: 1, additions: 1, deletions: 1 },
        unstaged: { fileCount: 1, additions: 1, deletions: 1 },
        staged: { fileCount: 1, additions: 1, deletions: 1 },
    },
    truncated: false,
    targetGeneration: 7,
}

const FILES_FOR = (target: DiffTarget | null) => {
    if (target === null) return null
    const files = target.kind === 'turn' ? TURN_FILES : target.kind === 'worktree' && target.area === 'staged' ? STAGED_FILES : TURN_FILES
    return {
        files,
        stats: { files: files.length, additions: files.reduce((s, f) => s + (f.additions ?? 0), 0), deletions: files.reduce((s, f) => s + (f.deletions ?? 0), 0) },
        truncated: false,
        targetGeneration: 7,
    }
}

const TARGET_TURN: DiffTarget = { kind: 'turn' }
const TARGET_STAGED: DiffTarget = { kind: 'worktree', area: 'staged' }

function makeDeps(overrides: {
    overview?: ReviewOverview | undefined
    overviewError?: string | null
    isLoading?: boolean
    filesFor?: (target: DiffTarget | null) => { files: ReviewFileEntry[]; truncated: boolean } | null
    contents?: { before: string | null; after: string | null } | null
    patchLoading?: boolean
    onQuery?: (path: string | null) => void
    running?: boolean | undefined
    refetch?: ReturnType<typeof vi.fn>
    commits?: ReviewCommit[]
    onInit?: () => void
}): GitReviewDeps {
    const filesFor = overrides.filesFor ?? FILES_FOR
    const initSpy = overrides.onInit ?? (() => {})
    return {
        useReviewOverview: () => ({ data: overrides.overview, error: overrides.overviewError ?? null, isLoading: overrides.isLoading ?? false, refetch: overrides.refetch ?? (() => {}) }),
        useReviewFiles: (_sessionId: string, target: DiffTarget | null) => {
            const data = filesFor(target)
            // stats/targetGeneration 测试多数不关心：补默认值
            const normalized = data ? { stats: { files: data.files.length, additions: 0, deletions: 0 }, targetGeneration: 7, ...data } : null
            return { data: normalized ?? undefined, error: null, isLoading: false }
        },
        useReviewPatch: (_sessionId: string, _target: DiffTarget | null, path: string | null) => {
            overrides.onQuery?.(path)
            const data = path ? { patch: '', previousPath: null, oversized: false, binary: false } : undefined
            return { data: overrides.patchLoading ? undefined : data, error: null, isLoading: overrides.patchLoading ?? false }
        },
        useReviewContents: (_sessionId: string, _target: DiffTarget | null, path: string | null) => {
            return {
                data: path && overrides.contents !== null ? { before: overrides.contents?.before ?? null, after: overrides.contents?.after ?? null, reason: null } : undefined,
                error: null,
                isLoading: false,
            }
        },
        useReviewCommits: () => ({ data: overrides.commits ?? [], error: null, isLoading: false, loadMore: () => {}, hasNextPage: false, isLoadingMore: false }),
        useReviewInit: () => ({ init: initSpy, isPending: false, error: null, succeededAt: 0 }),
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

describe('GitReviewView（hook 注入 v2）', () => {
    it('header 统计 + 清单默认全收起；点开才发起 patch/contents 查询（懒加载）', () => {
        const queries: (string | null)[] = []
        render(
            <GitReviewView
                sessionId="s1"
                deps={makeDeps({ overview: OVERVIEW, contents: { before: 'old', after: 'new' }, onQuery: (p) => queries.push(p) })}
            />,
        )

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

        // 点开即发起查询（target 由视图主体持有，查询只带 path）
        fireEvent.click(rows[0]!)
        const issued = queries.filter((q) => q !== null)
        expect(issued).toHaveLength(1)
        expect(issued[0]).toBe('b.ts')
        expect(expandedOf(rows[0]!)).toBe('true')
        expect(screen.getByTestId('diff-viewer-stub').getAttribute('data-path')).toBe('b.ts')
    })

    it('单击另一文件追加展开（多开不互斥；懒加载只对展开行发起查询）', () => {
        const queries: (string | null)[] = []
        render(
            <GitReviewView
                sessionId="s1"
                deps={makeDeps({ overview: OVERVIEW, contents: { before: '', after: 'new' }, onQuery: (p) => queries.push(p) })}
            />,
        )

        const rows = screen.getAllByTestId('review-file-row')
        fireEvent.click(rows[0]!)
        fireEvent.click(rows[1]!)
        expect(expandedOf(rows[0]!)).toBe('true')
        expect(expandedOf(rows[1]!)).toBe('true')
        expect(queries.at(-1)).toBe('src/deep/a.ts')

        // 再点同一行收起，另一行保持展开
        fireEvent.click(rows[1]!)
        expect(expandedOf(rows[1]!)).toBe('false')
        expect(expandedOf(rows[0]!)).toBe('true')
    })

    it('展开行 patch 请求中：行头出 loading 指示（chevron 位置），就绪后还原', () => {
        const { rerender } = render(
            <GitReviewView
                sessionId="s1"
                deps={makeDeps({ overview: OVERVIEW, contents: { before: '', after: 'new' }, patchLoading: true })}
            />,
        )
        const rows = screen.getAllByTestId('review-file-row')
        fireEvent.click(rows[0]!)
        // 请求中：行头（collapse header 内）出现 loading 指示
        expect(rows[0]!.closest('.ant-collapse-header')!.querySelector('[data-testid="review-row-loading"]')).not.toBeNull()
        expect(rows[1]!.closest('.ant-collapse-header')!.querySelector('[data-testid="review-row-loading"]')).toBeNull()

        // 就绪：loading 指示还原为展开箭头
        rerender(
            <GitReviewView
                sessionId="s1"
                deps={makeDeps({ overview: OVERVIEW, contents: { before: '', after: 'new' }, patchLoading: false })}
            />,
        )
        expect(rows[0]!.closest('.ant-collapse-header')!.querySelector('[data-testid="review-row-loading"]')).toBeNull()
    })

    it('行操作「在标签页中打开」：调 workspaceStore.openFileTab，不冒泡切换展开', () => {
        render(<GitReviewView sessionId="s1" deps={makeDeps({ overview: OVERVIEW, contents: { before: '', after: '' } })} />)
        const rows = screen.getAllByTestId('review-file-row')
        const btn = rows[1]!.querySelector('button[aria-label="review.openInTab"]') as HTMLButtonElement
        fireEvent.click(btn)
        const s = useWorkspaceStore.getState().getSession('s1')
        expect(s.tabs.some((t) => t.mode === 'file' && t.filePath === 'src/deep/a.ts')).toBe(true)
        expect(expandedOf(rows[1]!)).toBe('false')
    })

    it('空清单：提示空态且无文件行', () => {
        render(
            <GitReviewView
                sessionId="s1"
                deps={makeDeps({ overview: OVERVIEW, filesFor: () => ({ files: [], truncated: false }) })}
            />,
        )
        expect(screen.queryByTestId('review-file-row')).toBeNull()
        // 上一轮档空清单：文案区分「无快照变化」与其他档「暂无变更」
        expect(screen.getByText('review.noSnapshotChanges')).toBeDefined()
    })

    it('非 git 目录：turn 档可用；切 staged 档出「一键 init」空态，点按调 init；下拉 git 系禁用且无「提交…」项', () => {
        const nonGit: ReviewOverview = {
            ...OVERVIEW,
            isGitRepository: false,
            unavailableScopes: { turn: false, uncommitted: true, unstaged: true, staged: true, commit: true },
        }
        // turn 档可用
        render(<GitReviewView sessionId="s1" deps={makeDeps({ overview: nonGit, contents: { before: 'a', after: 'b' } })} />)
        expect(screen.getAllByTestId('review-file-row')).toHaveLength(2)
        cleanup()

        // 切到 staged（受控 target）→ 一键 init 空态
        const onInit = vi.fn()
        render(<GitReviewView sessionId="s1" target={TARGET_STAGED} deps={makeDeps({ overview: nonGit, onInit })} />)
        expect(screen.queryByTestId('review-file-row')).toBeNull()
        fireEvent.click(screen.getByTestId('review-init-git'))
        expect(onInit).toHaveBeenCalledTimes(1)
        cleanup()

        // turn 档下拉：git 系禁用 + needsGit 后缀、无「提交…」项
        render(<GitReviewView sessionId="s1" target={TARGET_TURN} deps={makeDeps({ overview: nonGit })} />)
        openScopeDropdown()
        const disabledOptions = [...document.querySelectorAll('.ant-select-item-option-disabled')]
        expect(disabledOptions.length).toBe(3)
        expect(disabledOptions[0]!.textContent).toContain('review.needsGit')
        expect(document.querySelectorAll('.ant-select-item-option')).toHaveLength(4) // 4 档，无 commits 项
    })

    it('commit 选择器：点「提交…」弹面板 → 选 commit 切 commit 档；根提交（无父）不可选', () => {
        const onTargetChange = vi.fn()
        render(<GitReviewView sessionId="s1" target={TARGET_TURN} onTargetChange={onTargetChange} deps={makeDeps({ overview: OVERVIEW, commits: COMMITS, contents: { before: '', after: '' } })} />)

        openScopeDropdown()
        const commitsOption = [...document.querySelectorAll('.ant-select-item-option')].find((o) => o.textContent === 'review.scope.commits')
        expect(commitsOption).toBeDefined()
        fireEvent.click(commitsOption!)

        // 面板出现：两行提交 + 根提交禁用
        const items = screen.getAllByTestId('review-commit-item')
        expect(items).toHaveLength(2)
        expect((items[0] as HTMLButtonElement).disabled).toBe(false)
        expect((items[1] as HTMLButtonElement).disabled).toBe(true) // 根提交 parentSha=null
        expect(items[0]!.textContent).toContain('feat: add login flow')

        fireEvent.click(items[0]!)
        expect(onTargetChange).toHaveBeenCalledWith({ kind: 'commit', range: { base: 'bbbbbbb444444444444444444444444444444444', head: 'aaaaaaa444444444444444444444444444444444' } })
    })

    it('layout 切换：非受控内部翻转 + 受控回调（inspector viewState 持久化通道）', () => {
        // 受控：点按钮回调带新值，组件不自改
        const onLayoutChange = vi.fn()
        const { rerender } = render(
            <GitReviewView sessionId="s1" layout="unified" onLayoutChange={onLayoutChange} deps={makeDeps({ overview: OVERVIEW, contents: { before: '', after: '' } })} />,
        )
        fireEvent.click(screen.getByTestId('review-layout-toggle'))
        expect(onLayoutChange).toHaveBeenCalledWith('split')
        // 受控值更新后按钮 tooltip 目标反转为「统一」
        rerender(<GitReviewView sessionId="s1" layout="split" onLayoutChange={onLayoutChange} deps={makeDeps({ overview: OVERVIEW, contents: { before: '', after: '' } })} />)
        fireEvent.click(screen.getByTestId('review-layout-toggle'))
        expect(onLayoutChange).toHaveBeenLastCalledWith('unified')

        // 非受控：内部 state 翻转（按钮可连续点击）
        cleanup()
        render(<GitReviewView sessionId="s1" deps={makeDeps({ overview: OVERVIEW, contents: { before: '', after: '' } })} />)
        const btn = () => screen.getByTestId('review-layout-toggle')
        fireEvent.click(btn())
        fireEvent.click(btn())
        expect(onLayoutChange).toHaveBeenCalledTimes(2) // 非受控实例不触发受控回调
    })

    it('拉数失败：错误文案替代清单', () => {
        render(<GitReviewView sessionId="s1" deps={makeDeps({ overviewError: 'boom' })} />)
        expect(screen.getByText('boom')).toBeDefined()
    })

    it('档位切换（受控）：staged 档文件列表随档刷新，查询带对路径', () => {
        const queries: (string | null)[] = []
        render(
            <GitReviewView
                sessionId="s1"
                target={TARGET_STAGED}
                deps={makeDeps({ overview: OVERVIEW, contents: { before: 'x', after: 'y' }, onQuery: (p) => queries.push(p) })}
            />,
        )
        const rows = screen.getAllByTestId('review-file-row')
        expect(rows).toHaveLength(1)
        fireEvent.click(rows[0]!)
        expect(queries.filter((q) => q !== null)).toEqual(['staged-only.txt'])
    })

    it('无快照链：上一轮档在下拉中禁用；内容区诚实空态（不装数据）', () => {
        const noChain: ReviewOverview = { ...OVERVIEW, scopes: { ...OVERVIEW.scopes, turn: null } }
        render(
            <GitReviewView
                sessionId="s1"
                deps={makeDeps({ overview: noChain, filesFor: (t) => (t?.kind === 'turn' ? null : FILES_FOR(t)) })}
            />,
        )
        expect(screen.getAllByText('review.noSnapshot').length).toBeGreaterThanOrEqual(1)

        openScopeDropdown()
        // antd v6 下拉禁用项 class：.ant-select-item-option-disabled
        const disabled = document.querySelector('.ant-select-item-option-disabled')
        expect(disabled).not.toBeNull()
        expect(disabled!.textContent).toContain('review.scope.lastTurn')
    })

    it('重命名：清单行成对呈现旧名', () => {
        const renames = (t: DiffTarget | null) => ({
            files: t?.kind === 'turn'
                ? [entry({ path: 'after.txt', kind: 'rename' as const, additions: 0, deletions: 0, previousPath: 'before.txt' })]
                : STAGED_FILES,
            truncated: false,
        })
        render(
            <GitReviewView
                sessionId="s1"
                deps={makeDeps({ overview: OVERVIEW, filesFor: renames, contents: { before: 'r', after: 'r' } })}
            />,
        )
        const row = screen.getByTestId('review-file-row')
        expect(row.textContent).toContain('after.txt')
        expect(row.textContent).toContain('before.txt')
    })

    it('oversized 行：可展开并发 diff 拉取（hydration 后读侧现场合成 patch；无 ref 由 RowDiff 按结果降级 tooBig）', () => {
        const big = (t: DiffTarget | null) => ({
            files: t?.kind === 'turn'
                ? [
                    entry({ path: 'huge.ts', additions: 6000, deletions: 0, oversized: true }),
                    entry({ path: 'text.ts', additions: 2, deletions: 0 }),
                ]
                : STAGED_FILES,
            truncated: false,
        })
        const queries: (string | null)[] = []
        render(
            <GitReviewView
                sessionId="s1"
                deps={makeDeps({ overview: OVERVIEW, filesFor: big, contents: { before: '', after: '' }, onQuery: (p) => queries.push(p) })}
            />,
        )
        const rows = screen.getAllByTestId('review-file-row')
        // oversized 不再前置拦截：行有箭头，点击展开并发 patch 查询
        expect(rows[0]!.querySelector('.review-row-chevron')).not.toBeNull()
        fireEvent.click(rows[0]!)
        expect(expandedOf(rows[0]!)).toBe('true')
        expect(queries.filter((q) => q !== null)).toContain('huge.ts')
        // 行内「打开标签页」仍可用
        fireEvent.click(rows[0]!.querySelector('button[aria-label="review.openInTab"]') as HTMLButtonElement)
        const s = useWorkspaceStore.getState().getSession('s1')
        expect(s.tabs.some((t) => t.mode === 'file' && t.filePath === 'huge.ts')).toBe(true)
        // 文本行照常展开
        fireEvent.click(rows[1]!)
        expect(expandedOf(rows[1]!)).toBe('true')
    })

    it('非文本条目：整行不可展开（无箭头、点击不发查询不出占位）', () => {
        const withBin = (t: DiffTarget | null) => ({
            files: t?.kind === 'turn'
                ? [
                    entry({ path: '16pic.jpg', kind: 'add' as const, additions: 0, deletions: 0 }),
                    entry({ path: 'text.ts', additions: 2, deletions: 0 }),
                ]
                : STAGED_FILES,
            truncated: false,
        })
        const queries: (string | null)[] = []
        render(
            <GitReviewView
                sessionId="s1"
                deps={makeDeps({ overview: OVERVIEW, filesFor: withBin, contents: { before: '', after: 'x' }, onQuery: (p) => queries.push(p) })}
            />,
        )

        // 点开图片行：行不可展开——无查询、无 diff、无展开箭头
        const rows = screen.getAllByTestId('review-file-row')
        fireEvent.click(rows[0]!)
        expect(queries.filter((q) => q !== null)).toHaveLength(0)
        expect(expandedOf(rows[0]!)).toBe('false')
        expect(rows[0]!.querySelector('.review-row-chevron')).toBeNull()
        expect(screen.queryByTestId('diff-viewer-stub')).toBeNull()

        // 文本行照常发查询
        fireEvent.click(rows[1]!)
        expect(queries.at(-1)).toBe('text.ts')
    })

    it('diff 文件树面板：开合按钮显隐；点叶节点联动主列表展开对应行', () => {
        const queries: (string | null)[] = []
        render(
            <GitReviewView
                sessionId="s1"
                deps={makeDeps({ overview: OVERVIEW, contents: { before: '', after: '' }, onQuery: (p) => queries.push(p) })}
            />,
        )

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
        expect(queries.at(-1)).toBe('src/deep/a.ts')
    })

    it('running→idle 翻转驱动 overview refetch（开着审查 tab 跑新轮次后自动刷新）', () => {
        const refetch = vi.fn()
        const { rerender } = render(<GitReviewView sessionId="s1" deps={makeDeps({ overview: OVERVIEW, running: true, refetch })} />)
        rerender(<GitReviewView sessionId="s1" deps={makeDeps({ overview: OVERVIEW, running: false, refetch })} />)
        expect(refetch).toHaveBeenCalledTimes(1)
        // idle→idle 不重复触发
        rerender(<GitReviewView sessionId="s1" deps={makeDeps({ overview: OVERVIEW, running: false, refetch })} />)
        expect(refetch).toHaveBeenCalledTimes(1)
    })
})
