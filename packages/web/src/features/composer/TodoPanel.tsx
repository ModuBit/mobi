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

/**
 * 清单面板（todo + task 合并展示）
 * CLI 的 TodoWrite 清单（todos）与任务清单（tasks）是同一类呈现，合并进一个折叠面板：
 * 一个头行（图标 + 进行中文案 + 合并完成统计 + 清理）+ 一条按状态排序的勾选列表。
 * - todo 行显示 content
 * - task 行显示 `id: subject`，副行 description，过滤 deleted 状态
 * 合并/排序/统计口径见 checklist.ts（气泡摘要共用同一份）。
 * 合并前是 TodoPanel / TaskPanel 两个逐行重复的组件。
 */

import { useMemo, useState, type ReactNode } from 'react'
import { Collapse, Checkbox, Typography } from 'antd'
import { Lightbulb } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import type { TodoItem, TaskItem } from '@mobi/shared'
import { ClearStateButton, type ClearRuntimeStateField } from '@/ui/base/interactive/ClearStateButton'
import { ShinyText } from '@/ui/base/motion/ShinyText'
import { buildChecklist, type ChecklistEntry, type ChecklistStatus } from './checklist'

/** 任务橙色，参考 Claude Code */
const CHECKLIST_ORANGE = '#e8825c'
const CHECKLIST_GREEN = '#52c41a'

const StyledCheckbox = styled(Checkbox)`
    .ant-checkbox-inner {
        border-radius: var(--radius-square);
    }
    &.ant-checkbox-checked .ant-checkbox-inner {
        background-color: ${CHECKLIST_GREEN};
        border-color: ${CHECKLIST_GREEN};
    }
    &.ant-checkbox-indeterminate .ant-checkbox-inner {
        background-color: ${CHECKLIST_ORANGE};
        border-color: ${CHECKLIST_ORANGE};
    }
    &.ant-checkbox-indeterminate .ant-checkbox-inner::after {
        background: #fff;
    }
`

export type TodoPanelProps = {
    todos: TodoItem[] | undefined
    tasks: TaskItem[] | undefined
    sessionId: string
    onClear: (sessionId: string, clearFields: ClearRuntimeStateField[]) => Promise<void>
    /**
     * 呈现形态：panel = 折叠面板（默认，composer 内联用）；
     * flat = 不要 Collapse 壳、头行 + 列表直接平铺（气泡 Popover 详情用）
     */
    variant?: 'panel' | 'flat'
}

export function TodoPanel({ todos, tasks, sessionId, onClear, variant = 'panel' }: TodoPanelProps) {
    const { t } = useTranslation()
    const [activeKeys, setActiveKeys] = useState<string[]>([])
    const checklist = useMemo(() => buildChecklist(todos, tasks), [todos, tasks])

    if (checklist.items.length === 0) return null
    const { items, completed, inProgress, total, activeText } = checklist

    const header = (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <Lightbulb size={14} color={CHECKLIST_ORANGE} />
            {activeText ? (
                <ShinyText solid style={{ color: CHECKLIST_ORANGE }}>
                    {activeText}
                </ShinyText>
            ) : completed === total ? (
                <span style={{ color: CHECKLIST_GREEN, fontWeight: 500 }}>✓ {t('chat.todo.allCompleted')}</span>
            ) : (
                <span style={{ color: 'var(--ant-color-text-tertiary)' }}>
                    {t('chat.task.pendingCount', { count: total - completed })}
                </span>
            )}
            <span style={{ fontSize: 12, color: 'var(--ant-color-text-tertiary)', marginLeft: 4 }}>
                <span style={{ color: 'var(--ant-color-text-secondary)', fontWeight: 500 }}>{completed}/{total}</span> {t('chat.todo.completed')}
                {inProgress > 0 && (
                    <>
                        {' · '}
                        <span style={{ color: CHECKLIST_ORANGE, fontWeight: 500 }}>{inProgress}</span> {t('chat.todo.inProgress')}
                    </>
                )}
            </span>
            <ClearStateButton
                sessionId={sessionId}
                clearFields={["todos", "tasks"]}
                onClear={onClear}
            />
        </div>
    )

    const list = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {items.map((entry) => {
                const description = entry.kind === 'task' && entry.task.description
                    ? <TaskDescription task={entry.task} />
                    : undefined
                const text = <ChecklistText status={entry.status}>{entryLabel(entry)}</ChecklistText>
                return (
                    <div
                        key={entry.key}
                        style={{
                            display: 'flex',
                            alignItems: description ? 'flex-start' : 'center',
                            gap: 8,
                            fontSize: 13,
                        }}
                    >
                        <StyledCheckbox
                            checked={entry.status === 'completed'}
                            indeterminate={entry.status === 'in_progress'}
                            disabled
                            style={description ? { lineHeight: '22px' } : undefined}
                        />
                        {description ? (
                            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                {text}
                                {description}
                            </div>
                        ) : text}
                    </div>
                )
            })}
        </div>
    )

    // flat：气泡 Popover 详情——不要折叠壳，头行与列表直接平铺（外衬由气泡详情容器提供）
    if (variant === 'flat') {
        return (
            <>
                {header}
                {list}
            </>
        )
    }

    return (
        <Collapse
            activeKey={activeKeys}
            onChange={(keys) => setActiveKeys(Array.isArray(keys) ? keys : [keys])}
            bordered={false}
            size="small"
            items={[{ key: 'checklist', label: header, children: list }]}
        />
    )
}

function entryLabel(entry: ChecklistEntry): string {
    return entry.kind === 'todo' ? entry.todo.content : `${entry.task.id}: ${entry.task.subject}`
}

/** 三态文字样式：进行中橙色扫光 / 完成划线 / 待办弱化 */
function ChecklistText({ status, children }: { status: ChecklistStatus; children: ReactNode }) {
    if (status === 'in_progress') {
        return (
            <ShinyText solid style={{ color: CHECKLIST_ORANGE, fontWeight: 600 }}>
                {children}
            </ShinyText>
        )
    }

    if (status === 'completed') {
        return (
            <span style={{ textDecoration: 'line-through', color: 'var(--ant-color-text-quaternary)' }}>
                {children}
            </span>
        )
    }

    return <span style={{ color: 'var(--ant-color-text-tertiary)' }}>{children}</span>
}

const { Text } = Typography

function TaskDescription({ task: { description, status } }: { task: TaskItem }) {
    return (
        <Text
            style={{
                fontSize: 12,
                color: 'var(--ant-color-text-quaternary)',
                lineHeight: '18px',
                textDecoration: status === 'completed' ? 'line-through' : 'none',
            }}
            ellipsis
        >
            {description}
        </Text>
    )
}
