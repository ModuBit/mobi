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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { queryKeys } from '@/core/lib/query-keys'
import type { ToolInfo, ToolPermission } from '@/domain/tool/types'
import type { PermissionUpdate } from '@mobi/shared'
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
                    'chat.tool.allowSession': '本次会话允许',
                    'chat.tool.allowProjectLocal': '当前项目允许（本地）',
                    'chat.tool.allowProject': '当前项目允许',
                    'chat.tool.allowUser': '当前用户允许',
                    'chat.tool.allowForSession': '本次会话允许',
                    'chat.tool.allowAll': '全部允许',
                    'chat.tool.waitingForApproval': '等待审批',
                    'chat.tool.requestFailed': '请求失败',
                    'chat.tool.irreversibleHint': '不可逆，谨慎',
                    'chat.tool.approveAutoAccept': '批准（自动接受编辑）',
                    'chat.tool.approveAuto': '批准（自动审批）',
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

// 每个用例在 beforeEach 新建（避免跨用例缓存污染）
let queryClient: QueryClient
let invalidateSpy: ReturnType<typeof vi.spyOn>

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConfigProvider>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ConfigProvider>
)

const sessionSuggestion: PermissionUpdate = {
    type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'git:*' }], behavior: 'allow', destination: 'session',
}
const projectSuggestion: PermissionUpdate = {
    type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'projectSettings',
}
const userSuggestion: PermissionUpdate = {
    type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'userSettings',
}

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

function withSuggestions(...suggestions: PermissionUpdate[]): Partial<ToolPermission> {
    return { id: 'p1', status: 'pending', suggestions }
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
        queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        })
        invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    })
    afterEach(cleanup)

    it('允许与拒绝同属 actions 组（PC 提级对等，不再物理隔离）', () => {
        renderFooter(makeTool())
        const allowBtn = screen.getByText('允许').closest('button')!
        const denyBtn = screen.getByText('拒绝').closest('button')!
        expect(allowBtn.closest('[data-group="actions"]')).not.toBeNull()
        expect(denyBtn.closest('[data-group="actions"]')).not.toBeNull()
    })

    it('点击允许调用 approve（无 updatedPermissions，仅本次）', async () => {
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

    it('approve 成功后失效 session 缓存，UI 移除 permission 不依赖 SSE', async () => {
        // 对齐 AskUserQuestion/RequestUserInput：approve 成功后主动失效 session 强制重拉 agentState，
        // 而非完全依赖 SSE session-updated 到达（SSE 丢失/迟到会导致 permission 卡住不消失）
        renderFooter(makeTool())
        fireEvent.click(screen.getByText('允许'))
        await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('s1', 'p1'))
        await waitFor(() => {
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.session('s1') })
        })
    })

    it('approve 返回 404（request 已被处理）时静默同步，不弹错误', async () => {
        // 场景：首次 approve 成功但 SSE 滞后 → UI 仍显示 permission → 用户重复点击 →
        // Hub 已删 request 返回 404。此时应静默拉最新状态让 UI 自愈，而非报错
        const notFound = new AxiosError('Request not found')
        ;(notFound as unknown as { response: { status: number } }).response = { status: 404 }
        mockApprove.mockRejectedValueOnce(notFound)
        renderFooter(makeTool())
        fireEvent.click(screen.getByText('允许'))
        await waitFor(() => {
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.session('s1') })
        })
        // 404 = 已处理，不弹错误
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('拒绝按钮为警示样式（text + danger 红字，非 primary block）', () => {
        renderFooter(makeTool())
        const denyBtn = screen.getByText('拒绝').closest('button')!
        // text 弱化（无填充）+ danger 警示色文字 —— 语义层红字提示「拒绝」，
        // 但非 primary 不抢视觉锚点
        expect(denyBtn.classList.contains('ant-btn-text')).toBe(true)
        expect(denyBtn.classList.contains('ant-btn-dangerous')).toBe(true)
        expect(denyBtn.classList.contains('ant-btn-primary')).toBe(false)
        expect(denyBtn.classList.contains('ant-btn-block')).toBe(false)
    })

    it('0 suggestion：构造 session fallback 档，渲染「本次会话允许」+「允许」+「拒绝」', () => {
        // SDK 给 0 suggestion 时，Web 构造 session 档 fallback，让 CLI mobi Set 兜底链路接通
        renderFooter(makeTool()) // makeTool 默认无 suggestion
        expect(screen.getByText('本次会话允许')).toBeInTheDocument() // fallback session 档
        expect(screen.getByText('允许')).toBeInTheDocument() // 允许本次（临时）
        expect(screen.getByText('拒绝')).toBeInTheDocument()
    })

    it('0 suggestion 点「本次会话允许」→ approve 回传 fallback updatedPermissions（Bash command ruleContent）', async () => {
        renderFooter(makeTool())
        fireEvent.click(screen.getByText('本次会话允许'))
        await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('s1', 'p1', {
            updatedPermissions: expect.arrayContaining([
                expect.objectContaining({
                    type: 'addRules',
                    destination: 'session',
                    behavior: 'allow',
                    rules: expect.arrayContaining([
                        expect.objectContaining({ toolName: 'Bash', ruleContent: 'rm -rf node_modules' }),
                    ]),
                }),
            ]),
        }))
    })

    it('有 session suggestion：渲染「本次会话允许」primary + 「允许」次 + 「拒绝」', () => {
        renderFooter(makeTool({ permission: withSuggestions(sessionSuggestion) }))
        const forSessionBtn = screen.getByText('本次会话允许').closest('button')!
        const allowBtn = screen.getByText('允许').closest('button')!
        // 最窄档（session）提为 primary
        expect(forSessionBtn.classList.contains('ant-btn-primary')).toBe(true)
        // 「允许」降为次级 default
        expect(allowBtn.classList.contains('ant-btn-primary')).toBe(false)
    })

    it('有 session + project + user 三档：按窄→宽排序，session 为 primary', () => {
        renderFooter(makeTool({ permission: withSuggestions(projectSuggestion, userSuggestion, sessionSuggestion) }))
        const sessionBtn = screen.getByText('本次会话允许').closest('button')!
        const projectBtn = screen.getByText('当前项目允许').closest('button')!
        const userBtn = screen.getByText('当前用户允许').closest('button')!
        // session 为 primary（最窄）
        expect(sessionBtn.classList.contains('ant-btn-primary')).toBe(true)
        expect(projectBtn.classList.contains('ant-btn-primary')).toBe(false)
        expect(userBtn.classList.contains('ant-btn-primary')).toBe(false)
        // 窄→宽顺序：session 在 project 之前，project 在 user 之前
        expect(sessionBtn.compareDocumentPosition(projectBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(projectBtn.compareDocumentPosition(userBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('点击「本次会话允许」→ approve 带 updatedPermissions', async () => {
        renderFooter(makeTool({ permission: withSuggestions(sessionSuggestion) }))
        fireEvent.click(screen.getByText('本次会话允许'))
        await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('s1', 'p1', {
            updatedPermissions: expect.arrayContaining([expect.objectContaining({ destination: 'session' })]),
        }))
    })

    it('点击「当前项目允许」→ approve 带 projectSettings 档 updatedPermissions', async () => {
        renderFooter(makeTool({ permission: withSuggestions(sessionSuggestion, projectSuggestion) }))
        fireEvent.click(screen.getByText('当前项目允许'))
        await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('s1', 'p1', {
            updatedPermissions: expect.arrayContaining([expect.objectContaining({ destination: 'projectSettings' })]),
        }))
    })

    it('移动端：最窄档独占满宽行，其余档+允许+拒绝并排在次要行', () => {
        renderFooter(makeTool({ permission: withSuggestions(sessionSuggestion, projectSuggestion) }))
        const sessionBtn = screen.getByText('本次会话允许').closest('button')!
        const projectBtn = screen.getByText('当前项目允许').closest('button')!
        const allowBtn = screen.getByText('允许').closest('button')!
        const denyBtn = screen.getByText('拒绝').closest('button')!
        // 主操作 block 满宽独占
        expect(sessionBtn.classList.contains('ant-btn-block')).toBe(true)
        // 次操作、拒绝均非 block（在并排行 flex:1）
        expect(projectBtn.classList.contains('ant-btn-block')).toBe(false)
        expect(allowBtn.classList.contains('ant-btn-block')).toBe(false)
        expect(denyBtn.classList.contains('ant-btn-block')).toBe(false)
        // 其余档+允许+拒绝同处次要行，主操作不在次要行
        const subRow = projectBtn.closest('[data-sub-row="secondary"]')
        expect(subRow).not.toBeNull()
        expect(allowBtn.closest('[data-sub-row="secondary"]')).toBe(subRow)
        expect(denyBtn.closest('[data-sub-row="secondary"]')).toBe(subRow)
        expect(sessionBtn.closest('[data-sub-row="secondary"]')).toBeNull()
    })

    it('Edit 工具：允许仍为 primary，全部允许为次级 default（避免误开 acceptEdits）', () => {
        // Edit 无 suggestion 档；「全部允许」=切 acceptEdits 模式（更激进），不提 primary
        renderFooter(
            makeTool({
                name: 'Edit',
                input: { file_path: 'a.ts', old_string: 'x', new_string: 'y' },
            }),
        )
        const allowBtn = screen.getByText('允许').closest('button')!
        const allEditsBtn = screen.getByText('全部允许').closest('button')!
        expect(allowBtn.classList.contains('ant-btn-primary')).toBe(true)
        expect(allEditsBtn.classList.contains('ant-btn-primary')).toBe(false)
        // 全部允许与拒绝并排在次要行
        expect(allEditsBtn.closest('[data-sub-row="secondary"]')).not.toBeNull()
    })

    it('Edit 工具即使 SDK 给 suggestion 也不渲染持久化档（走 acceptEdits 路径）', () => {
        renderFooter(
            makeTool({
                name: 'Edit',
                input: { file_path: 'a.ts', old_string: 'x', new_string: 'y' },
                permission: withSuggestions(sessionSuggestion),
            }),
        )
        expect(screen.queryByText('本次会话允许')).not.toBeInTheDocument()
        expect(screen.getByText('全部允许')).toBeInTheDocument()
    })

    it('ExitPlanMode 渲染四按钮，auto 为 primary 且自动审批调用 approve', async () => {
        renderFooter(
            makeTool({
                name: 'ExitPlanMode',
                input: { plan: 'step 1' },
            }),
        )
        // 四个按钮均渲染
        const auto = screen.getByText('批准（自动审批）').closest('button')!
        const autoAccept = screen.getByText('批准（自动接受编辑）').closest('button')!
        const manual = screen.getByText('批准（手动审批）')
        const keepPlanning = screen.getByText('继续规划')
        expect(auto).toBeInTheDocument()
        expect(autoAccept).toBeInTheDocument()
        expect(manual).toBeInTheDocument()
        expect(keepPlanning).toBeInTheDocument()

        // auto 为 primary（最前），acceptEdits/manual 降普通
        expect(auto.classList.contains('ant-btn-primary')).toBe(true)
        expect(autoAccept.classList.contains('ant-btn-primary')).toBe(false)

        // 自动审批 → approveWithMode('auto') → api.permissions.approve({ mode: 'auto' })
        fireEvent.click(auto)
        await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('s1', 'p1', { mode: 'auto' }))
        await waitFor(() => expect(mockSetPermissionMode).toHaveBeenCalledWith('s1', 'auto'))
    })
})
