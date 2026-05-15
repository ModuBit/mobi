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
import { BulbOutlined } from '@ant-design/icons'
import styled from '@emotion/styled'
import type { TodoItem } from '@mobi/shared'
import { BlinkText } from '@/components/ui/BlinkText'

/** 任务橙色，参考 Claude Code */
const TODO_ORANGE = '#e8825c'
const TODO_GREEN = '#52c41a'

const StyledCheckbox = styled(Checkbox)<{ $status: TodoItem['status'] }>`
    .ant-checkbox-inner {
        border-radius: 4px;
    }
    &.ant-checkbox-checked .ant-checkbox-inner {
        background-color: ${p => p.$status === 'completed' ? TODO_GREEN : TODO_ORANGE};
        border-color: ${p => p.$status === 'completed' ? TODO_GREEN : TODO_ORANGE};
    }
`

export type TodoPanelProps = {
    todos: TodoItem[] | undefined
}

export function TodoPanel({ todos }: TodoPanelProps) {
    const { token } = theme.useToken()
    const [activeKeys, setActiveKeys] = useState<string[]>(['todo'])

    if (!todos || todos.length === 0) return null

    const total = todos.length
    const completed = todos.filter(t => t.status === 'completed').length
    const inProgress = todos.filter(t => t.status === 'in_progress').length
    const activeTodo = todos.find(t => t.status === 'in_progress')

    const header = (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <BulbOutlined style={{ color: TODO_ORANGE }} />
            {activeTodo ? (
                <BlinkText blinking highlightColor={TODO_ORANGE}>
                    {activeTodo.activeForm}
                </BlinkText>
            ) : completed === total ? (
                <span style={{ color: TODO_GREEN, fontWeight: 500 }}>✓ 全部完成</span>
            ) : null}
            <span style={{ fontSize: 12, color: token.colorTextTertiary, marginLeft: 4 }}>
                <span style={{ color: token.colorTextSecondary, fontWeight: 500 }}>{completed}/{total}</span> 已完成
                {inProgress > 0 && (
                    <>
                        {' · '}
                        <span style={{ color: TODO_ORANGE, fontWeight: 500 }}>{inProgress}</span> 进行中
                    </>
                )}
            </span>
        </div>
    )

    const items = [
        {
            key: 'todo',
            label: header,
            children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {todos.map((todo, idx) => (
                        <div
                            key={String(idx)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                fontSize: 13,
                            }}
                        >
                            <StyledCheckbox
                                checked={todo.status === 'completed' || todo.status === 'in_progress'}
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
            size="small"
            items={items}
            style={{ marginBottom: 4 }}
        />
    )
}

function TodoText({ todo }: { todo: TodoItem }) {
    if (todo.status === 'in_progress') {
        return (
            <BlinkText
                blinking
                highlightColor={TODO_ORANGE}
                style={{ fontWeight: 600, color: TODO_ORANGE }}
            >
                {todo.content}
            </BlinkText>
        )
    }

    if (todo.status === 'completed') {
        return (
            <span style={{ textDecoration: 'line-through', color: '#999' }}>
                {todo.content}
            </span>
        )
    }

    return <span style={{ color: '#666' }}>{todo.content}</span>
}
