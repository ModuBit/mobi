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

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { TodoPanel } from '@/components/composer/TodoPanel'
import type { TodoItem } from '@mobi/shared'

// mock i18next
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => {
            const map: Record<string, string> = {
                'chat.todo.allCompleted': '全部完成',
                'chat.todo.completed': '已完成',
                'chat.todo.inProgress': '进行中',
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

describe('TodoPanel', () => {
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
