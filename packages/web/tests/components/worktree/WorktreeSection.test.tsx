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
import { render, screen, waitFor, within, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { App as AntdApp, ConfigProvider } from 'antd'
import type { WorktreeSummary } from '@mobi/shared'
import { WorktreeSection } from '@/features/settings/sections/WorktreeSection'

const state = vi.hoisted(() => ({
    list: {
        data: undefined as WorktreeSummary[] | undefined,
        isLoading: false,
        isError: false,
        isFetching: false,
        refetch: vi.fn()
    },
    discard: vi.fn(),
    discarding: false,
    navigate: vi.fn()
}))

vi.mock('@/core/data/hooks/queries/useWorktrees', () => ({
    useWorktrees: () => state.list
}))
vi.mock('@/core/data/hooks/mutations/useWorktreeActions', () => ({
    useWorktreeActions: () => ({ discard: state.discard, discarding: state.discarding, mergeBack: vi.fn(), merging: false })
}))
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => state.navigate
}))
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}))

const CLEAN: WorktreeSummary = {
    name: 'feat-a',
    branch: 'mobi/feat-a',
    worktreePath: '/repo-worktrees/feat-a',
    repoRoot: '/repo',
    repoBranch: 'main',
    sessionId: 's1',
    state: 'clean',
    dirtyFileCount: 0,
    sizeBytes: 2048,
    createdAt: Date.now() - 60_000,
    lastCommitAt: Date.now() - 30_000
}

const RUNNING: WorktreeSummary = {
    ...CLEAN,
    name: 'feat-b',
    branch: 'mobi/feat-b',
    worktreePath: '/repo-worktrees/feat-b',
    sessionId: undefined,
    state: 'running',
    dirtyFileCount: 3
}

function renderSection() {
    return render(
        <ConfigProvider>
            <AntdApp>
                <WorktreeSection />
            </AntdApp>
        </ConfigProvider>
    )
}

describe('WorktreeSection（设置页 worktree 管理）', () => {
    beforeEach(() => {
        state.list = { data: [CLEAN, RUNNING], isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }
        state.discard.mockReset()
        state.discarding = false
    })
    afterEach(cleanup)

    it('渲染列表字段：名称/分支/脏文件数/占用/孤儿标记', () => {
        renderSection()
        expect(screen.getByText('feat-a')).toBeInTheDocument()
        expect(screen.getByText('mobi/feat-a')).toBeInTheDocument()
        // 两行各有一条脏文件数
        expect(screen.getAllByText('settings.worktrees.dirtyFiles')).toHaveLength(2)
        expect(screen.getAllByText('2.0 KB')).toHaveLength(2)
        // 有会话的行给跳转入口；无会话的行标孤儿
        expect(screen.getByText('settings.worktrees.openSession')).toBeInTheDocument()
        expect(screen.getByText('settings.worktrees.orphan')).toBeInTheDocument()
        expect(screen.getByText('settings.worktrees.state.clean')).toBeInTheDocument()
        expect(screen.getByText('settings.worktrees.state.running')).toBeInTheDocument()
    })

    it('运行中的行：合回与丢弃均禁用', () => {
        renderSection()
        const row = screen.getByTestId('worktree-row-feat-b')
        const buttons = within(row).getAllByRole('button')
        expect(buttons).toHaveLength(2)
        for (const button of buttons) {
            expect(button).toBeDisabled()
            expect(button).toHaveAttribute('title', 'settings.worktrees.runningHint')
        }
    })

    it('丢弃需要二次确认，确认后按路径请求并提示成功', async () => {
        state.discard.mockResolvedValue({ ok: true, worktreeRemoved: true, branchDeleted: true })
        renderSection()

        const row = screen.getByTestId('worktree-row-feat-a')
        within(row).getByText('settings.worktrees.discard').click()

        // antd confirm 弹层：确认按钮文案为 discard（行内同名按钮在弹层之外）
        expect(await screen.findAllByText('settings.worktrees.discardConfirmTitle')).not.toHaveLength(0)
        const confirmButton = document.querySelector<HTMLButtonElement>('.ant-modal-confirm-btns .ant-btn-primary')
        expect(confirmButton).not.toBeNull()
        confirmButton!.click()

        await waitFor(() => expect(state.discard).toHaveBeenCalledWith('/repo-worktrees/feat-a'))
        // 成功反馈走 messageApi.success（文案 key 直通）
        expect(await screen.findByText('settings.worktrees.discarded')).toBeInTheDocument()
    })

    it('丢弃被拒：提示失败而非成功', async () => {
        state.discard.mockResolvedValue({ ok: false, reason: 'git-failed' })
        renderSection()

        const row = screen.getByTestId('worktree-row-feat-a')
        within(row).getByText('settings.worktrees.discard').click()
        await screen.findAllByText('settings.worktrees.discardConfirmTitle')
        document.querySelector<HTMLButtonElement>('.ant-modal-confirm-btns .ant-btn-primary')!.click()

        expect(await screen.findByText('settings.worktrees.discardFailed')).toBeInTheDocument()
        expect(screen.queryByText('settings.worktrees.discarded')).not.toBeInTheDocument()
    })

    it('扫描失败：展示告警；空列表：展示空态', () => {
        state.list = { ...state.list, isError: true }
        renderSection()
        expect(screen.getByText('settings.worktrees.scanFailed')).toBeInTheDocument()

        cleanup()
        state.list = { ...state.list, isError: false, data: [] }
        renderSection()
        expect(screen.getByText('settings.worktrees.empty')).toBeInTheDocument()
    })

    it('会话跳转：点击「打开会话」进入对应会话页', () => {
        renderSection()
        screen.getByText('settings.worktrees.openSession').click()
        expect(state.navigate).toHaveBeenCalledWith({ to: '/sessions/$sessionId', params: { sessionId: 's1' } })
    })
})
