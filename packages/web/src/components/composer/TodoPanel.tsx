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

import { useState } from 'react'
import { Collapse, Checkbox, theme } from 'antd'
import { Lightbulb } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import type { TodoItem } from '@mobi/shared'
import { BlinkText } from '@/components/ui/BlinkText'
import { ClearStateButton } from './ClearStateButton'

/** 任务橙色，参考 Claude Code */
const TODO_ORANGE = '#e8825c'
const TODO_GREEN = '#52c41a'

const STATUS_ORDER: Record<TodoItem['status'], number> = {
    in_progress: 0,
    pending: 1,
    completed: 2,
}

const StyledCheckbox = styled(Checkbox)<{ $status: TodoItem['status'] }>`
    .ant-checkbox-inner {
        border-radius: 4px;
    }
    &.ant-checkbox-checked .ant-checkbox-inner {
        background-color: ${TODO_GREEN};
        border-color: ${TODO_GREEN};
    }
    &.ant-checkbox-indeterminate .ant-checkbox-inner {
        background-color: ${TODO_ORANGE};
        border-color: ${TODO_ORANGE};
    }
    &.ant-checkbox-indeterminate .ant-checkbox-inner::after {
        background: #fff;
    }
`

export type TodoPanelProps = {
    todos: TodoItem[] | undefined
    sessionId: string
    onClear: (sessionId: string, clearFields: ('todos' | 'tasks' | 'backgroundTasks')[]) => Promise<void>
}

export function TodoPanel({ todos, sessionId, onClear }: TodoPanelProps) {
    const { token } = theme.useToken()
    const { t } = useTranslation()
    const [activeKeys, setActiveKeys] = useState<string[]>([])

    if (!todos || todos.length === 0) return null

    const sortedTodos = todos
        .map((todo, idx) => ({ todo, idx }))
        .sort((a, b) => STATUS_ORDER[a.todo.status] - STATUS_ORDER[b.todo.status] || a.idx - b.idx)
        .map(({ todo }) => todo)

    let completed = 0, inProgress = 0
    let activeTodo: TodoItem | undefined
    for (const t of todos) {
        if (t.status === 'completed') completed++
        else if (t.status === 'in_progress') { inProgress++; activeTodo = t }
    }
    const total = todos.length

    const header = (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <Lightbulb size={14} color={TODO_ORANGE} />
            {activeTodo ? (
                <BlinkText blinking color={TODO_ORANGE}>
                    {activeTodo.activeForm}
                </BlinkText>
            ) : completed === total ? (
                <span style={{ color: TODO_GREEN, fontWeight: 500 }}>✓ {t('chat.todo.allCompleted')}</span>
            ) : null}
            <span style={{ fontSize: 12, color: token.colorTextTertiary, marginLeft: 4 }}>
                <span style={{ color: token.colorTextSecondary, fontWeight: 500 }}>{completed}/{total}</span> {t('chat.todo.completed')}
                {inProgress > 0 && (
                    <>
                        {' · '}
                        <span style={{ color: TODO_ORANGE, fontWeight: 500 }}>{inProgress}</span> {t('chat.todo.inProgress')}
                    </>
                )}
            </span>
            <ClearStateButton
                sessionId={sessionId}
                clearField="todos"
                onClear={onClear}
            />
        </div>
    )

    const items = [
        {
            key: 'todo',
            label: header,
            children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {sortedTodos.map((todo) => (
                        <div
                            key={todo.content}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                fontSize: 13,
                            }}
                        >
                            <StyledCheckbox
                                checked={todo.status === 'completed'}
                                indeterminate={todo.status === 'in_progress'}
                                disabled
                                $status={todo.status}
                            />
                            <TodoText todo={todo} />
                        </div>
                    ))}
                </div>
            ),
        },
    ]

    return (
        <Collapse
            activeKey={activeKeys}
            onChange={(keys) => setActiveKeys(Array.isArray(keys) ? keys : [keys])}
            bordered={false}
            size="small"
            items={items}
        />
    )
}

function TodoText({ todo }: { todo: TodoItem }) {
    const { token } = theme.useToken()

    if (todo.status === 'in_progress') {
        return (
            <BlinkText
                blinking
                color={TODO_ORANGE}
                style={{ fontWeight: 600 }}
            >
                {todo.content}
            </BlinkText>
        )
    }

    if (todo.status === 'completed') {
        return (
            <span style={{ textDecoration: 'line-through', color: token.colorTextQuaternary }}>
                {todo.content}
            </span>
        )
    }

    return <span style={{ color: token.colorTextTertiary }}>{todo.content}</span>
}
