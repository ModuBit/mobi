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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import type React from 'react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import type { MergeBackResult, WorktreeSummary } from '@mobi/shared'
import { WorktreeMergeModal } from '@/ui/shared/worktree/WorktreeMergeModal'

// 动作 hook 的稳定桩：断言提交入参与运行中态，不触达网络
const actionState = vi.hoisted(() => ({
    mergeBack: vi.fn(),
    merging: false
}))

vi.mock('@/core/data/hooks/mutations/useWorktreeActions', () => ({
    useWorktreeActions: () => ({
        mergeBack: actionState.mergeBack,
        merging: actionState.merging,
        discard: vi.fn(),
        discarding: false
    })
}))

vi.mock('react-i18next', async () => {
    const { i18nKeyStub } = await import('../../helpers/i18nStub')
    return i18nKeyStub()
})

const SUMMARY: WorktreeSummary = {
    name: 'feat-a',
    branch: 'mobi/feat-a',
    worktreePath: '/repo-worktrees/feat-a',
    repoRoot: '/repo',
    repoBranch: 'main',
    state: 'dirty',
    dirtyFileCount: 2,
    sizeBytes: 1024
}

function renderModal(summary: WorktreeSummary | null = SUMMARY) {
    return render(
        <ConfigProvider>
            <WorktreeMergeModal open summary={summary} onClose={() => {}} />
        </ConfigProvider>
    )
}

/** 目标 worktree 在动作后被列表刷新改变（移除 → null / 同路径新对象） */
function rerenderModal(rerender: (ui: React.ReactElement) => void, summary: WorktreeSummary | null) {
    rerender(
        <ConfigProvider>
            <WorktreeMergeModal open summary={summary} onClose={() => {}} />
        </ConfigProvider>
    )
}

/** 点「确认合回」并等待动作落定 */
async function submit() {
    screen.getByText('settings.worktrees.mergeConfirm').click()
    await waitFor(() => expect(actionState.mergeBack).toHaveBeenCalled())
}

describe('WorktreeMergeModal', () => {
    beforeEach(() => {
        actionState.merging = false
        actionState.mergeBack.mockReset()
    })
    afterEach(cleanup)

    it('默认策略 no-ff：提交后回报策略，成功态展示清理结果', async () => {
        const success: MergeBackResult = {
            ok: true,
            strategy: 'no-ff',
            worktreeRemoved: true,
            branchDeleted: true
        }
        actionState.mergeBack.mockResolvedValue(success)
        renderModal()
        await submit()

        expect(actionState.mergeBack).toHaveBeenCalledWith({
            worktreePath: SUMMARY.worktreePath,
            strategy: 'no-ff'
        })
        // 成功态：动作面板让位给结果说明（不再有第二颗确认按钮）
        expect(await screen.findByText('settings.worktrees.merged')).toBeInTheDocument()
        expect(screen.getByText(/settings.worktrees.mergedWorktreeRemoved/)).toBeInTheDocument()
        expect(screen.getByText(/settings.worktrees.mergedBranchDeleted/)).toBeInTheDocument()
        expect(screen.getByText('common.close')).toBeInTheDocument()
        expect(screen.queryByText('settings.worktrees.mergeConfirm')).not.toBeInTheDocument()
    })

    it('切到 squash 后提交，按 squash 策略请求', async () => {
        actionState.mergeBack.mockResolvedValue({
            ok: true,
            strategy: 'squash',
            worktreeRemoved: true,
            branchDeleted: true
        } satisfies MergeBackResult)
        renderModal()

        // 单选卡片：点策略标题即选中其 Radio
        screen.getByText('settings.worktrees.strategySquash').click()
        await submit()

        expect(actionState.mergeBack).toHaveBeenCalledWith({
            worktreePath: SUMMARY.worktreePath,
            strategy: 'squash'
        })
    })

    it('冲突态：展示冲突文件清单（不做成功渲染）', async () => {
        actionState.mergeBack.mockResolvedValue({
            ok: false,
            reason: 'merge-failed',
            conflict: true,
            files: ['src/a.ts', 'src/b.ts']
        } satisfies MergeBackResult)
        renderModal()
        await submit()

        expect(await screen.findByText('settings.worktrees.conflictTitle')).toBeInTheDocument()
        expect(screen.getByText('src/a.ts')).toBeInTheDocument()
        expect(screen.getByText('src/b.ts')).toBeInTheDocument()
        expect(screen.queryByText('settings.worktrees.merged')).not.toBeInTheDocument()
    })

    it('拒绝态：展示 reason 对应文案，主树脏时附文件清单', async () => {
        actionState.mergeBack.mockResolvedValue({
            ok: false,
            reason: 'main-dirty',
            files: ['dirty.ts']
        } satisfies MergeBackResult)
        renderModal()
        await submit()

        expect(await screen.findByText('settings.worktrees.rejectedTitle')).toBeInTheDocument()
        expect(screen.getByText('settings.worktrees.reason.mainDirty')).toBeInTheDocument()
        expect(screen.getByText('dirty.ts')).toBeInTheDocument()
    })

    it('运行中 worktree：确认按钮禁用（点按不发请求）', async () => {
        actionState.mergeBack.mockResolvedValue({ ok: true, strategy: 'no-ff', worktreeRemoved: false, branchDeleted: false })
        renderModal({ ...SUMMARY, state: 'running' })

        const confirm = screen.getByText('settings.worktrees.mergeConfirm').closest('button')
        expect(confirm).toBeDisabled()
        expect(screen.getByText('settings.worktrees.runningHint')).toBeInTheDocument()

        confirm!.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(actionState.mergeBack).not.toHaveBeenCalled()
    })

    it('列表未命中（summary 为 null）：仍可打开，确认按钮禁用', () => {
        renderModal(null)
        const confirm = screen.getByText('settings.worktrees.mergeConfirm').closest('button')
        expect(confirm).toBeDisabled()
    })

    it('成功后列表刷新把目标移出（summary → null）：结果反馈不被重置', async () => {
        actionState.mergeBack.mockResolvedValue({
            ok: true,
            strategy: 'no-ff',
            worktreeRemoved: true,
            branchDeleted: true
        } satisfies MergeBackResult)
        const { rerender } = renderModal()
        await submit()
        expect(await screen.findByText('settings.worktrees.merged')).toBeInTheDocument()

        // merge 成功后 workflow 失效列表缓存：worktree 已移除 → 摘要变 null
        rerenderModal(rerender, null)
        expect(screen.getByText('settings.worktrees.merged')).toBeInTheDocument()
        expect(screen.getByText('common.close')).toBeInTheDocument()
        expect(screen.queryByText('settings.worktrees.mergeConfirm')).not.toBeInTheDocument()
    })

    it('失败后同路径列表刷新换了对象引用：拒绝反馈不被重置', async () => {
        actionState.mergeBack.mockResolvedValue({ ok: false, reason: 'main-dirty' } satisfies MergeBackResult)
        const { rerender } = renderModal()
        await submit()
        expect(await screen.findByText('settings.worktrees.rejectedTitle')).toBeInTheDocument()

        // 同路径新对象（列表 refetch 的正常产物）
        rerenderModal(rerender, { ...SUMMARY })
        expect(screen.getByText('settings.worktrees.rejectedTitle')).toBeInTheDocument()
        expect(screen.getByText('settings.worktrees.reason.mainDirty')).toBeInTheDocument()
    })
})
