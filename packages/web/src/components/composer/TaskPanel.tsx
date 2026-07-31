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
import { Collapse, Checkbox, Typography, theme } from 'antd'
import { CheckCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import type { TaskItem } from '@mobi/shared'
import { BlinkText } from '@/components/ui/BlinkText'
import { ClearStateButton, type ClearRuntimeStateField } from './ClearStateButton'

/** 任务橙色，参考 Claude Code */
const TASK_ORANGE = '#e8825c'
const TASK_GREEN = '#52c41a'

const STATUS_ORDER: Record<TaskItem['status'], number> = {
    in_progress: 0,
    pending: 1,
    completed: 2,
    deleted: 3,
}

const StyledCheckbox = styled(Checkbox)<{ $status: TaskItem['status'] }>`
    .ant-checkbox-inner {
        border-radius: 4px;
    }
    &.ant-checkbox-checked .ant-checkbox-inner {
        background-color: ${TASK_GREEN};
        border-color: ${TASK_GREEN};
    }
    &.ant-checkbox-indeterminate .ant-checkbox-inner {
        background-color: ${TASK_ORANGE};
        border-color: ${TASK_ORANGE};
    }
    &.ant-checkbox-indeterminate .ant-checkbox-inner::after {
        background: #fff;
    }
`

export type TaskPanelProps = {
    tasks: TaskItem[] | undefined
    sessionId: string
    onClear: (sessionId: string, clearFields: ClearRuntimeStateField[]) => Promise<void>
}

export function TaskPanel({ tasks, sessionId, onClear }: TaskPanelProps) {
    const { token } = theme.useToken()
    const { t } = useTranslation()
    const [activeKeys, setActiveKeys] = useState<string[]>([])

    // 过滤掉 deleted 状态
    const visibleTasks = tasks?.filter(t => t.status !== 'deleted')
    if (!visibleTasks || visibleTasks.length === 0) return null

    const sortedTasks = visibleTasks
        .map((task, idx) => ({ task, idx }))
        .sort((a, b) => STATUS_ORDER[a.task.status] - STATUS_ORDER[b.task.status] || a.idx - b.idx)
        .map(({ task }) => task)

    let completed = 0, inProgress = 0
    let activeTask: TaskItem | undefined
    for (const t of visibleTasks) {
        if (t.status === 'completed') completed++
        else if (t.status === 'in_progress') { inProgress++; activeTask = t }
    }
    const total = visibleTasks.length

    const header = (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <CheckCheck size={14} color={TASK_ORANGE} />
            {activeTask ? (
                <BlinkText blinking color={TASK_ORANGE}>
                    {activeTask.activeForm ?? activeTask.subject}
                </BlinkText>
            ) : completed === total ? (
                <span style={{ color: TASK_GREEN, fontWeight: 500 }}>✓ {t('chat.task.allCompleted')}</span>
            ) : (
                <span style={{ color: token.colorTextTertiary }}>
                    {t('chat.task.pendingCount', { count: total - completed })}
                </span>
            )}
            <span style={{ fontSize: 12, color: token.colorTextTertiary, marginLeft: 4 }}>
                <span style={{ color: token.colorTextSecondary, fontWeight: 500 }}>{completed}/{total}</span> {t('chat.task.completed')}
                {inProgress > 0 && (
                    <>
                        {' · '}
                        <span style={{ color: TASK_ORANGE, fontWeight: 500 }}>{inProgress}</span> {t('chat.task.inProgress')}
                    </>
                )}
            </span>
            <ClearStateButton
                sessionId={sessionId}
                clearField="tasks"
                onClear={onClear}
            />
        </div>
    )

    const items = [
        {
            key: 'task',
            label: header,
            children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {sortedTasks.map((task) => (
                        <div
                            key={task.id}
                            style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}
                        >
                            <StyledCheckbox
                                checked={task.status === 'completed'}
                                indeterminate={task.status === 'in_progress'}
                                disabled
                                $status={task.status}
                                style={{ lineHeight: '22px' }}
                            />
                            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                <TaskText task={task} />
                                {task.description && <TaskDescription task={task} />}
                            </div>
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

function taskLabel(task: TaskItem) {
    return `${task.id}: ${task.subject}`
}

function TaskText({ task }: { task: TaskItem }) {
    const { token } = theme.useToken()
    const label = taskLabel(task)

    if (task.status === 'in_progress') {
        return (
            <BlinkText blinking color={TASK_ORANGE} style={{ fontWeight: 600 }}>
                {label}
            </BlinkText>
        )
    }

    if (task.status === 'completed') {
        return (
            <span style={{ textDecoration: 'line-through', color: token.colorTextQuaternary }}>
                {label}
            </span>
        )
    }

    return <span style={{ color: token.colorTextTertiary }}>{label}</span>
}

const { Text } = Typography

function TaskDescription({ task }: { task: TaskItem }) {
    const { token } = theme.useToken()

    return (
        <Text
            style={{
                fontSize: 12,
                color: token.colorTextQuaternary,
                lineHeight: '18px',
                textDecoration: task.status === 'completed' ? 'line-through' : 'none',
            }}
            ellipsis
        >
            {task.description}
        </Text>
    )
}
