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
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { TodoPanel } from '@/features/composer/TodoPanel'
import type { TaskItem, TodoItem } from '@mobi/shared'

// vitest 未开 globals，渲染型测试需显式 cleanup（todo/task 两分区合并后同文件共用 DOM）
afterEach(cleanup)

// mock i18next
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => {
            const map: Record<string, string> = {
                'chat.todo.allCompleted': '全部完成',
                'chat.todo.completed': '已完成',
                'chat.todo.inProgress': '进行中',
                'chat.task.allCompleted': '全部完成',
                'chat.task.completed': '已完成',
                'chat.task.inProgress': '进行中',
                'chat.task.pendingCount': '{{count}} 个待执行',
            }
            return map[key] ?? key
        },
    }),
}))

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
)

const makeTodo = (content: string, status: TodoItem['status']): TodoItem => ({
    content,
    status,
    activeForm: `正在${content}`,
})

const makeTask = (
    id: string,
    subject: string,
    status: TaskItem['status'],
    activeForm?: string,
): TaskItem => ({
    id,
    subject,
    status,
    activeForm,
})

describe('TodoPanel（todo 分区）', () => {
    it('todos 为空时返回 null', () => {
        const { container } = render(<TodoPanel todos={[]} />, { wrapper })
        expect(container.innerHTML).toBe('')
    })

    it('todos 为 undefined 时返回 null', () => {
        const { container } = render(<TodoPanel todos={undefined} />, { wrapper })
        expect(container.innerHTML).toBe('')
    })

    it('渲染 Collapse 并显示统计信息', () => {
        const todos = [
            makeTodo('任务A', 'completed'),
            makeTodo('任务B', 'in_progress'),
            makeTodo('任务C', 'pending'),
        ]
        render(<TodoPanel todos={todos} />, { wrapper })

        // 统计: 1/3 已完成 · 1 进行中
        expect(screen.getByText('1/3')).toBeInTheDocument()
        expect(screen.getByText('进行中', { exact: false })).toBeInTheDocument()
    })

    it('按状态排序：in_progress → pending → completed', () => {
        const todos = [
            makeTodo('已完成任务', 'completed'),
            makeTodo('等待任务', 'pending'),
            makeTodo('进行中任务', 'in_progress'),
        ]
        render(<TodoPanel todos={todos} />, { wrapper })

        // in_progress 的 activeForm 显示在 header（Collapse 收起状态也可见）
        expect(screen.getByText('正在进行中任务')).toBeInTheDocument()
    })

    it('全部完成时显示全部完成提示', () => {
        const todos = [
            makeTodo('任务A', 'completed'),
            makeTodo('任务B', 'completed'),
        ]
        render(<TodoPanel todos={todos} />, { wrapper })

        expect(screen.getByText(/全部完成/)).toBeInTheDocument()
    })

    it('默认收起', () => {
        const todos = [makeTodo('任务A', 'pending')]
        render(<TodoPanel todos={todos} />, { wrapper })

        // Collapse 收起时，列表内容不在 DOM 中
        expect(screen.queryByText('任务A')).not.toBeInTheDocument()
    })
})

describe('TodoPanel（task 分区，原 TaskPanel）', () => {
    it('tasks 为空时返回 null', () => {
        const { container } = render(<TodoPanel tasks={[]} />, { wrapper })
        expect(container.innerHTML).toBe('')
    })

    it('tasks 为 undefined 时返回 null', () => {
        const { container } = render(<TodoPanel tasks={undefined} />, { wrapper })
        expect(container.innerHTML).toBe('')
    })

    it('渲染 Collapse 并显示统计信息', () => {
        const tasks = [
            makeTask('1', '任务A', 'completed'),
            makeTask('2', '任务B', 'in_progress'),
            makeTask('3', '任务C', 'pending'),
        ]
        render(<TodoPanel tasks={tasks} />, { wrapper })

        // 统计: 1/3 已完成 · 1 进行中
        expect(screen.getByText('1/3')).toBeInTheDocument()
        expect(screen.getByText('进行中', { exact: false })).toBeInTheDocument()
    })

    it('按状态排序：in_progress → pending → completed', () => {
        const tasks = [
            makeTask('1', '已完成任务', 'completed'),
            makeTask('2', '等待任务', 'pending'),
            makeTask('3', '进行中任务', 'in_progress', '正在进行中任务'),
        ]
        render(<TodoPanel tasks={tasks} />, { wrapper })

        // in_progress 的 activeForm 显示在 header（Collapse 收起状态也可见）
        expect(screen.getByText('正在进行中任务')).toBeInTheDocument()
    })

    it('不展示 status=deleted 的 task', () => {
        const tasks = [
            makeTask('1', '正常任务', 'pending'),
            makeTask('2', '已删除任务', 'deleted'),
        ]
        render(<TodoPanel tasks={tasks} />, { wrapper })

        // 统计应为 0/1（deleted 不计入）
        expect(screen.getByText('0/1')).toBeInTheDocument()

        // 已删除任务不应出现在 DOM 中
        expect(screen.queryByText('已删除任务')).not.toBeInTheDocument()
    })

    it('activeForm 缺失时 fallback 到 subject', () => {
        const tasks = [
            makeTask('1', '进行中无activeForm', 'in_progress'),
        ]
        render(<TodoPanel tasks={tasks} />, { wrapper })

        // header 中应显示 subject（因为没有 activeForm）
        expect(screen.getByText('进行中无activeForm')).toBeInTheDocument()
    })

    it('默认收起', () => {
        const tasks = [makeTask('1', '任务A', 'pending')]
        render(<TodoPanel tasks={tasks} />, { wrapper })

        // Collapse 收起时，列表内容不在 DOM 中
        expect(screen.queryByText('任务A')).not.toBeInTheDocument()
    })
})

describe('TodoPanel（todo + task 合并面板）', () => {
    it('两类数据合并进同一个 Collapse，统计合并计数', () => {
        const todos = [makeTodo('待办A', 'pending')]
        const tasks = [makeTask('1', '任务A', 'completed')]
        const { container } = render(<TodoPanel todos={todos} tasks={tasks} />, { wrapper })

        expect(container.querySelectorAll('.ant-collapse').length).toBe(1)
        expect(screen.getByText('1/2')).toBeInTheDocument()
    })

    it('进行中文案取 todo 的 activeForm（同列表顺序）', () => {
        const todos = [makeTodo('待办A', 'in_progress')]
        const tasks = [makeTask('1', '任务A', 'in_progress', '正在任务A')]
        render(<TodoPanel todos={todos} tasks={tasks} />, { wrapper })

        expect(screen.getByText('正在待办A')).toBeInTheDocument()
    })

    it('flat 模式不渲染 Collapse，头行与列表直接平铺（Popover 详情用）', () => {
        const { container } = render(
            <TodoPanel todos={[makeTodo('待办A', 'pending')]} variant="flat" />,
            { wrapper },
        )

        expect(container.querySelector('.ant-collapse')).toBeNull()
        expect(screen.getByText('待办A')).toBeInTheDocument()
    })
})
