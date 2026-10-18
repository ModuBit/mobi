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

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import type { TaskItem, TodoItem } from '@mobi/shared'
import type { MobiApi } from '@/core/data/api/client'
import { ComposerStatusPills, useComposerStatusSummary } from '@/features/composer/ComposerStatusPills'

// 摘要文案断言按真实插值行为 mock（`{{count}}` 等占位替换）
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: vi.fn() },
    useTranslation: () => ({
        t: (key: string, opts?: Record<string, unknown>) => {
            const map: Record<string, string> = {
                'chat.statusPills.todoCompleted': '{{completed}}/{{total}} 已完成',
                'chat.statusPills.executing': '执行中 {{count}}',
                'chat.statusPills.allDone': '全部完成',
                'chat.statusPills.tasksExecuting': '执行中 {{active}}/{{total}}',
                'chat.statusPills.tasksTotal': '共 {{total}}',
            }
            let text = map[key] ?? key
            if (opts) {
                for (const [name, value] of Object.entries(opts)) {
                    text = text.replaceAll(`{{${name}}}`, String(value))
                }
            }
            return text
        },
    }),
}))

// mock PixelAvatar，jsdom 不支持 canvas
vi.mock('@/ui/pixel-avatar/PixelAvatar', () => ({
    PixelAvatar: () => null,
}))

const mockApi = {
    sessions: { stopTask: vi.fn() },
} as unknown as MobiApi

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
)

beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})

afterEach(cleanup)

async function loadForegroundStore() {
    const { useForegroundTasksStore } = await import('@/core/data/stores/foregroundTasksStore')
    return useForegroundTasksStore
}

function makeTodo(content: string, status: TodoItem['status']): TodoItem {
    return { content, status, activeForm: `正在${content}` }
}

function makeTask(id: string, subject: string, status: TaskItem['status']): TaskItem {
    return { id, subject, status }
}

/** 测试宿主：summary 由页面对应的 hook 计算一次后传入（与被测组件同一条数据流） */
function PillsHarness({
    todos,
    tasks,
    api,
}: {
    todos?: TodoItem[]
    tasks?: TaskItem[]
    api: MobiApi
}) {
    const summary = useComposerStatusSummary('test-session', todos, tasks)
    return (
        <ComposerStatusPills
            summary={summary}
            todos={todos}
            tasks={tasks}
            sessionId="test-session"
            api={api}
            onOpenToolUseId={() => {}}
            onClear={async () => {}}
        />
    )
}

function renderPills(todos?: TodoItem[], tasks?: TaskItem[]) {
    return render(<PillsHarness todos={todos} tasks={tasks} api={mockApi} />, { wrapper })
}

describe('ComposerStatusPills', () => {
    it('两类数据都为空时返回 null', () => {
        const { container } = renderPills()
        expect(container.innerHTML).toBe('')
    })

    it('todo 气泡显示「完成数/总数 · 执行中数」', () => {
        renderPills([makeTodo('待办A', 'completed'), makeTodo('待办B', 'in_progress')])
        const pill = screen.getByTestId('status-pill-todo')
        expect(pill.textContent).toContain('1/2 已完成')
        expect(pill.textContent).toContain('执行中 1')
        expect(pill).toHaveAttribute('data-running', 'true')
    })

    it('全部完成时 todo 气泡显示「全部完成」且不带运行态标记', () => {
        renderPills([makeTodo('待办A', 'completed'), makeTodo('待办B', 'completed')])
        const pill = screen.getByTestId('status-pill-todo')
        expect(pill.textContent).toContain('全部完成')
        expect(pill).not.toHaveAttribute('data-running')
    })

    it('tasks 气泡按面板口径汇总：执行中 / 总数', async () => {
        const useForegroundTasksStore = await loadForegroundStore()
        useForegroundTasksStore.getState().set('test-session', [
            { toolUseId: 'fg-1', description: '前台研究', subagentType: 'Explore', startedAt: Date.now() },
        ])
        renderPills()
        expect(screen.getByTestId('status-pill-tasks').textContent).toContain('执行中 1/1')
        useForegroundTasksStore.getState().set('test-session', [])
    })

    it('tasks 气泡只在有活跃任务时带运行态标记', async () => {
        const useForegroundTasksStore = await loadForegroundStore()
        const { useBackgroundTasksStore } = await import('@/core/data/stores/backgroundTasksStore')
        useForegroundTasksStore.getState().set('test-session', [
            { toolUseId: 'fg-1', description: '前台研究', subagentType: 'Explore', startedAt: Date.now() },
        ])
        renderPills()
        expect(screen.getByTestId('status-pill-tasks')).toHaveAttribute('data-running', 'true')

        // 换成已完成的后台任务：气泡仍在（共 1），但标记随活跃态摘除
        useForegroundTasksStore.getState().set('test-session', [])
        useBackgroundTasksStore.getState().setTasks('test-session', [
            {
                taskId: 'bt-1',
                toolUseId: 'tu-1',
                toolName: 'Bash',
                description: '扫描发布记录',
                status: 'completed',
                isBackground: true,
                startedAt: Date.now(),
            },
        ])
        await waitFor(() => {
            expect(screen.getByTestId('status-pill-tasks')).not.toHaveAttribute('data-running')
        })
        useBackgroundTasksStore.getState().clearSession('test-session')
    })

    it('点击 tasks 气泡打开 Popover，平铺展示任务卡片', async () => {
        const useForegroundTasksStore = await loadForegroundStore()
        useForegroundTasksStore.getState().set('test-session', [
            { toolUseId: 'fg-1', description: '前台研究', subagentType: 'Explore', startedAt: Date.now() },
        ])
        renderPills()
        fireEvent.click(screen.getByTestId('status-pill-tasks'))
        expect(await screen.findByText('前台研究')).toBeInTheDocument()
        useForegroundTasksStore.getState().set('test-session', [])
    })

    it('点击 todo 气泡打开 Popover，平铺展示清单项', async () => {
        renderPills([makeTodo('待办A', 'pending')])
        fireEvent.click(screen.getByTestId('status-pill-todo'))
        expect(await screen.findByText('待办A')).toBeInTheDocument()
    })

    it('两个气泡的详情互斥：打开另一个会收起当前详情', async () => {
        const useForegroundTasksStore = await loadForegroundStore()
        useForegroundTasksStore.getState().set('test-session', [
            { toolUseId: 'fg-1', description: '前台研究', subagentType: 'Explore', startedAt: Date.now() },
        ])
        renderPills([makeTodo('待办A', 'pending')])

        fireEvent.click(screen.getByTestId('status-pill-tasks'))
        expect(await screen.findByText('前台研究')).toBeInTheDocument()

        fireEvent.click(screen.getByTestId('status-pill-todo'))
        expect(await screen.findByText('待办A')).toBeInTheDocument()

        await waitFor(() => {
            const visible = [...document.querySelectorAll('[data-mobi-popover]')]
            expect(visible).toHaveLength(1)
        })
        useForegroundTasksStore.getState().set('test-session', [])
    })

    it('气泡消失后重新出现时不残留打开态（不会自动弹开详情）', async () => {
        const { rerender } = render(<PillsHarness api={mockApi} todos={[makeTodo('待办A', 'pending')]} />, { wrapper })

        fireEvent.click(screen.getByTestId('status-pill-todo'))
        expect(await screen.findByText('待办A')).toBeInTheDocument()

        // 清单被清空 → 气泡卸载（受控 Popover 卸载不会回调 onOpenChange）
        rerender(<PillsHarness api={mockApi} />)
        expect(screen.queryByTestId('composer-status-pills')).toBeNull()

        // 数据重新出现 → 气泡重现，详情必须保持关闭
        rerender(<PillsHarness api={mockApi} todos={[makeTodo('待办A', 'pending')]} />)
        await waitFor(() => {
            const visible = [...document.querySelectorAll('[data-mobi-popover]')]
            expect(visible).toHaveLength(0)
        })
    })
})

describe('useComposerStatusSummary（ChatContainer 用同一份 summary 决定 spacer 与气泡内容）', () => {
    it('两类数据都为空时两个 visible 标志均 false', () => {
        const { result } = renderHook(() => useComposerStatusSummary('test-session', undefined, undefined))
        expect(result.current.showTodo).toBe(false)
        expect(result.current.showTasks).toBe(false)
    })

    it('todo 或 task 有数据时对应标志为 true（deleted task 不计入）', async () => {
        const todo = renderHook(() => useComposerStatusSummary('test-session', [makeTodo('A', 'pending')], undefined))
        expect(todo.result.current.showTodo).toBe(true)

        const deletedOnly = renderHook(() => useComposerStatusSummary('test-session', undefined, [makeTask('1', 'A', 'deleted')]))
        expect(deletedOnly.result.current.showTodo).toBe(false)

        const task = renderHook(() => useComposerStatusSummary('test-session', undefined, [makeTask('1', 'A', 'pending')]))
        expect(task.result.current.showTodo).toBe(true)
    })

    it('清单摘要与 TodoPanel 同源：进行中/待执行/全部完成口径', () => {
        const { result } = renderHook(() => useComposerStatusSummary(
            'test-session',
            [makeTodo('A', 'in_progress'), makeTodo('B', 'pending')],
            [makeTask('1', 'C', 'completed')],
        ))
        expect(result.current.checklist.total).toBe(3)
        expect(result.current.checklist.inProgress).toBe(1)
        expect(result.current.checklist.pending).toBe(1)
        expect(result.current.checklist.completed).toBe(1)
        expect(result.current.checklist.allDone).toBe(false)
    })
})
