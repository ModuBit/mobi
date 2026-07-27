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

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { PermissionFooter } from '@/components/tool-card/PermissionFooter'
import type { ToolInfo } from '@/domain/tool/types'
import type { MobiApi } from '@/core/data/api/client'

// mock i18next — 与 AskUserQuestionFooter.test.tsx 同样的模式
vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>()
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string) => {
                const map: Record<string, string> = {
                    'chat.tool.allow': '允许',
                    'chat.tool.deny': '拒绝',
                    'chat.tool.allowForSession': '本次会话允许',
                    'chat.tool.allowAll': '全部允许',
                    'chat.tool.waitingForApproval': '等待审批',
                    'chat.tool.requestFailed': '请求失败',
                    'chat.tool.irreversibleHint': '不可逆，谨慎',
                    'chat.tool.approveAutoAccept': '批准（自动接受编辑）',
                    'chat.tool.approveManual': '批准（手动审批）',
                    'chat.tool.keepPlanning': '继续规划',
                    'chat.tool.keepPlanningPlaceholder': '告诉 Claude 接下来做什么',
                    'chat.tool.sendFeedback': '发送反馈',
                }
                return map[key] ?? key
            },
        }),
    }
})

const mockApprove = vi.fn().mockResolvedValue(undefined)
const mockDeny = vi.fn().mockResolvedValue(undefined)
const mockSetPermissionMode = vi.fn().mockResolvedValue(undefined)
const mockApi = {
    permissions: { approve: mockApprove, deny: mockDeny },
    sessions: { setPermissionMode: mockSetPermissionMode },
} as unknown as MobiApi

// 强制走移动端分支（actionMinHeight = 44px）
vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    useIsMobile: () => true,
}))

// jsdom 没有 ResizeObserver（Ant Design TextArea 需要）
beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
)

function makeTool(overrides: Partial<ToolInfo> = {}): ToolInfo {
    return {
        name: 'Bash',
        input: { command: 'rm -rf node_modules' },
        result: undefined,
        state: 'running',
        description: null,
        startedAt: null,
        createdAt: Date.now(),
        permission: { id: 'p1', status: 'pending' },
        sdkHints: undefined,
        ...overrides,
    } as ToolInfo
}

function renderFooter(tool: ToolInfo) {
    return render(
        <PermissionFooter
            api={mockApi}
            sessionId="s1"
            metadata={null}
            tool={tool}
            disabled={false}
            onDone={vi.fn()}
        />,
        { wrapper },
    )
}

describe('PermissionFooter', () => {
    beforeEach(() => {
        mockApprove.mockClear()
        mockDeny.mockClear()
        mockSetPermissionMode.mockClear()
    })
    afterEach(cleanup)

    it('允许与拒绝同属 actions 组（PC 提级对等，不再物理隔离）', () => {
        renderFooter(makeTool())
        const allowBtn = screen.getByText('允许').closest('button')!
        const denyBtn = screen.getByText('拒绝').closest('button')!
        expect(allowBtn.closest('[data-group="actions"]')).not.toBeNull()
        expect(denyBtn.closest('[data-group="actions"]')).not.toBeNull()
    })

    it('点击允许调用 approve', async () => {
        renderFooter(makeTool())
        fireEvent.click(screen.getByText('允许'))
        await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('s1', 'p1'))
    })

    it('点击拒绝调用 deny', async () => {
        renderFooter(makeTool())
        fireEvent.click(screen.getByText('拒绝'))
        await waitFor(() => expect(mockDeny).toHaveBeenCalledWith('s1', 'p1'))
    })

    it('Edit 工具显示全部允许次级按钮', () => {
        renderFooter(
            makeTool({
                name: 'Edit',
                input: { file_path: 'a.ts', old_string: 'x', new_string: 'y' },
            }),
        )
        expect(screen.getByText('全部允许')).toBeInTheDocument()
    })

    it('error 以 Alert 形式渲染（role=alert）', async () => {
        mockApprove.mockRejectedValueOnce(new Error('boom'))
        renderFooter(makeTool())
        fireEvent.click(screen.getByText('允许'))
        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    })

    it('拒绝按钮为弱化 text 样式（非 primary block）', () => {
        renderFooter(makeTool())
        const denyBtn = screen.getByText('拒绝').closest('button')!
        expect(denyBtn.classList.contains('ant-btn-text')).toBe(true)
        expect(denyBtn.classList.contains('ant-btn-primary')).toBe(false)
    })

    it('ExitPlanMode 渲染三按钮且自动接受调用 approve', async () => {
        renderFooter(
            makeTool({
                name: 'ExitPlanMode',
                input: { plan: 'step 1' },
            }),
        )
        // 三个按钮均渲染
        const autoAccept = screen.getByText('批准（自动接受编辑）')
        const manual = screen.getByText('批准（手动审批）')
        const keepPlanning = screen.getByText('继续规划')
        expect(autoAccept).toBeInTheDocument()
        expect(manual).toBeInTheDocument()
        expect(keepPlanning).toBeInTheDocument()

        // 自动接受 → approveWithMode('acceptEdits') → api.permissions.approve
        fireEvent.click(autoAccept)
        await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('s1', 'p1', { mode: 'acceptEdits' }))
    })
})
