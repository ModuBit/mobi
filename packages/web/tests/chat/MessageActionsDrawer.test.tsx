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
import { MessageActionsDrawer } from '@/components/chat/MessageActionsDrawer'

// mock i18next：提供菜单与确认视图文案（initReactI18next 必须 noop 导出，避免 i18n 顶层 init 报错）
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
        t: (key: string) => {
            const map: Record<string, string> = {
                'chat.copy': '复制',
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

// 渲染型测试显式 cleanup（vitest 未开 globals，DOM 累积会炸）
afterEach(() => {
    cleanup()
    vi.clearAllMocks()
})

const canRewindTarget = {
    key: 'item-1',
    text: 'hello world',
    nativeId: 'u1',
    canRewind: true,
}

const cannotRewindTarget = {
    key: 'item-2',
    text: 'old message',
    nativeId: null,
    canRewind: false,
}

function renderDrawer(overrides: Partial<Parameters<typeof MessageActionsDrawer>[0]> = {}) {
    const props = {
        open: true,
        target: canRewindTarget,
        rewindActive: false,
        dryRun: { canRewind: true, canRestoreFiles: true },
        loading: false,
        onClose: vi.fn(),
        onRewind: vi.fn(),
        onConfirmRewind: vi.fn(),
        onCancelRewind: vi.fn(),
        ...overrides,
    }
    render(<MessageActionsDrawer {...props} />)
    return props
}

describe('MessageActionsDrawer（移动端长按操作菜单）', () => {
    it('可 rewind 消息 → 菜单列出 复制 / 回退并编辑', () => {
        renderDrawer()
        expect(screen.getByText('复制')).toBeTruthy()
        expect(screen.getByRole('button', { name: '回退并编辑' })).toBeTruthy()
    })

    it('不可 rewind → 菜单只有复制', () => {
        renderDrawer({ target: cannotRewindTarget })
        expect(screen.getByText('复制')).toBeTruthy()
        expect(screen.queryByRole('button', { name: '回退并编辑' })).toBeNull()
    })

    it('点「回退并编辑」→ 触发 onRewind(nativeId)', () => {
        const props = renderDrawer()
        fireEvent.click(screen.getByRole('button', { name: '回退并编辑' }))
        expect(props.onRewind).toHaveBeenCalledWith('u1')
    })

    it('rewindActive → 复制行保留 + 回退并编辑行隐藏 + 确认内容就地展开（合并一层）', () => {
        renderDrawer({ rewindActive: true, dryRun: { canRewind: true, canRestoreFiles: true } })
        // 复制行仍在（一层，不整页切换）
        expect(screen.getByText('复制')).toBeTruthy()
        // 菜单里的「回退并编辑」行隐藏（Drawer 标题是 span 非 button）
        expect(screen.queryByRole('button', { name: '回退并编辑' })).toBeNull()
        // 确认内容就地展开
        expect(screen.getByText('恢复代码并回退')).toBeTruthy()
        expect(screen.getByText('仅回退对话')).toBeTruthy()
    })

    it('rewindActive + dryRun null（预检拉取中）→ 复制行保留 + loading 态，无选项', () => {
        renderDrawer({ rewindActive: true, dryRun: null })
        expect(screen.getByText('复制')).toBeTruthy()
        expect(screen.queryByText('恢复代码并回退')).toBeNull()
    })

    it('确认视图确认 → onConfirmRewind 透传 restoreFiles', () => {
        const props = renderDrawer({ rewindActive: true, dryRun: { canRewind: true, canRestoreFiles: true } })
        fireEvent.click(screen.getByText('恢复代码并回退'))
        expect(props.onConfirmRewind).toHaveBeenCalledWith(true)
    })

    it('选复制 → 执行剪贴板写入并关闭（onClose）', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined)
        Object.assign(navigator, { clipboard: { writeText } })
        const props = renderDrawer()
        fireEvent.click(screen.getByText('复制'))
        await vi.waitFor(() => {
            expect(writeText).toHaveBeenCalledWith('hello world')
            expect(props.onClose).toHaveBeenCalled()
        })
    })

    it('open=false → 不渲染菜单', () => {
        renderDrawer({ open: false })
        expect(screen.queryByText('复制')).toBeNull()
    })
})
