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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { RewindConfirmView, RewindDialog } from '@/components/chat/RewindDialog'

// mock i18next：提供 rewind 弹窗文案映射（initReactI18next 必须 noop 导出，避免 i18n 顶层 init 报错）
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
        t: (key: string) => {
            const map: Record<string, string> = {
                'chat.rewind.title': '回退并编辑',
                'chat.rewind.restoreAndRewind': '恢复代码并回退',
                'chat.rewind.rewindOnly': '仅回退对话',
                'chat.rewind.filesUnavailable': '文件快照已超出保留窗口，将仅回退对话',
                'common.cancel': '取消',
            }
            return map[key] ?? key
        },
    }),
}))

// useIsMobile：默认桌面（Modal 形态）；单测内可切换
const useIsMobileMock = vi.fn(() => false)
vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    useIsMobile: () => useIsMobileMock(),
}))

// 渲染型测试显式 cleanup（vitest 未开 globals，DOM 累积会炸）
afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    useIsMobileMock.mockReturnValue(false)
})

const bothTrue = { canRewind: true, canRestoreFiles: true }
const degraded = { canRewind: true, canRestoreFiles: false }

describe('RewindConfirmView（确认视图三形态，spec §5.3）', () => {
    it('dry-run 双 true → 两选项：恢复代码并回退 / 仅回退对话', () => {
        render(<RewindConfirmView dryRun={bothTrue} loading={false} onConfirm={vi.fn()} onCancel={vi.fn()} />)
        expect(screen.getByRole('button', { name: '恢复代码并回退' })).toBeTruthy()
        expect(screen.getByRole('button', { name: '仅回退对话' })).toBeTruthy()
        expect(screen.queryByText('文件快照已超出保留窗口，将仅回退对话')).toBeNull()
    })

    it('canRestoreFiles false → 单选项 + 降级说明文案', () => {
        render(<RewindConfirmView dryRun={degraded} loading={false} onConfirm={vi.fn()} onCancel={vi.fn()} />)
        expect(screen.queryByRole('button', { name: '恢复代码并回退' })).toBeNull()
        expect(screen.getAllByRole('button', { name: '仅回退对话' }).length).toBe(1)
        expect(screen.getByText('文件快照已超出保留窗口，将仅回退对话')).toBeTruthy()
    })

    it('dryRun null（预检拉取中）→ loading 态，无选项', () => {
        render(<RewindConfirmView dryRun={null} loading={false} onConfirm={vi.fn()} onCancel={vi.fn()} />)
        expect(screen.queryByRole('button', { name: '仅回退对话' })).toBeNull()
    })

    it('确认 → onConfirm 携带 restoreFiles（true / false 两入口）', () => {
        const onConfirm = vi.fn()
        render(<RewindConfirmView dryRun={bothTrue} loading={false} onConfirm={onConfirm} onCancel={vi.fn()} />)
        fireEvent.click(screen.getByRole('button', { name: '恢复代码并回退' }))
        expect(onConfirm).toHaveBeenCalledWith(true)
        fireEvent.click(screen.getByRole('button', { name: '仅回退对话' }))
        expect(onConfirm).toHaveBeenCalledWith(false)
    })

    it('降级形态确认 → onConfirm(false)', () => {
        const onConfirm = vi.fn()
        render(<RewindConfirmView dryRun={degraded} loading={false} onConfirm={onConfirm} onCancel={vi.fn()} />)
        fireEvent.click(screen.getByRole('button', { name: '仅回退对话' }))
        expect(onConfirm).toHaveBeenCalledWith(false)
    })

    it('executing（loading）→ 按钮禁用 + 取消不可用', () => {
        render(<RewindConfirmView dryRun={bothTrue} loading onConfirm={vi.fn()} onCancel={vi.fn()} />)
        expect((screen.getByRole('button', { name: '恢复代码并回退' }) as HTMLButtonElement).disabled).toBe(true)
        expect((screen.getByRole('button', { name: '仅回退对话' }) as HTMLButtonElement).disabled).toBe(true)
        expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
    })
})

describe('RewindDialog（桌面 Modal / 移动底部 Drawer）', () => {
    it('桌面渲染 Modal 形态且透传确认视图', () => {
        render(<RewindDialog open dryRun={bothTrue} loading={false} onConfirm={vi.fn()} onCancel={vi.fn()} />)
        expect(screen.getByText('回退并编辑')).toBeTruthy()
        expect(screen.getByRole('button', { name: '恢复代码并回退' })).toBeTruthy()
    })

    it('open=false → 不渲染内容', () => {
        render(<RewindDialog open={false} dryRun={bothTrue} loading={false} onConfirm={vi.fn()} onCancel={vi.fn()} />)
        expect(screen.queryByRole('button', { name: '恢复代码并回退' })).toBeNull()
    })

    it('移动端渲染底部 Drawer 形态（复用确认视图）', () => {
        useIsMobileMock.mockReturnValue(true)
        render(<RewindDialog open dryRun={bothTrue} loading={false} onConfirm={vi.fn()} onCancel={vi.fn()} />)
        expect(screen.getByText('回退并编辑')).toBeTruthy()
        expect(screen.getByRole('button', { name: '恢复代码并回退' })).toBeTruthy()
    })
})
