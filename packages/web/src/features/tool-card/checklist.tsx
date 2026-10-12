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

import { isObject } from '@mobi/shared'

export type ChecklistStatus = 'pending' | 'in_progress' | 'completed'

export type ChecklistItem = {
    id?: string
    text: string
    status: ChecklistStatus
}

function normalizeChecklistStatus(value: unknown): ChecklistStatus {
    if (value === 'completed') return 'completed'
    if (value === 'in_progress') return 'in_progress'
    return 'pending'
}

function parseChecklistEntries(
    entries: unknown,
    opts: {
        textKey: 'content' | 'step'
        idKey?: string
    }
): ChecklistItem[] {
    if (!Array.isArray(entries)) return []

    const items: ChecklistItem[] = []
    for (const entry of entries) {
        if (!isObject(entry)) continue

        const text = entry[opts.textKey]
        if (typeof text !== 'string') continue

        const idValue = opts.idKey ? entry[opts.idKey] : undefined
        items.push({
            id: typeof idValue === 'string' ? idValue : undefined,
            text,
            status: normalizeChecklistStatus(entry.status)
        })
    }

    return items
}

export function extractTodoChecklist(input: unknown, result: unknown): ChecklistItem[] {
    if (isObject(input) && Array.isArray(input.todos)) {
        const items = parseChecklistEntries(input.todos, {
            textKey: 'content',
            idKey: 'id'
        })
        if (items.length > 0) return items
    }

    if (isObject(result) && Array.isArray(result.newTodos)) {
        return parseChecklistEntries(result.newTodos, {
            textKey: 'content',
            idKey: 'id'
        })
    }

    return []
}

export function extractUpdatePlanChecklist(input: unknown, result: unknown): ChecklistItem[] {
    if (isObject(input) && Object.prototype.hasOwnProperty.call(input, 'plan')) {
        return parseChecklistEntries(input.plan, {
            textKey: 'step'
        })
    }

    if (isObject(result)) {
        return parseChecklistEntries(result.plan, {
            textKey: 'step'
        })
    }

    return []
}

function checklistTone(item: ChecklistItem): string {
    if (item.status === 'completed') return 'line-through'
    return 'none'
}

function checklistColor(item: ChecklistItem): string {
    if (item.status === 'completed') return '#3f7a3a'
    if (item.status === 'in_progress') return '#3d3d3a'
    return '#b0aea5'
}

function checklistIcon(item: ChecklistItem): string {
    if (item.status === 'completed') return '☑'
    return '☐'
}

export function ChecklistList(props: { items: ChecklistItem[]; emptyLabel?: string | null }) {
    if (props.items.length === 0) {
        return props.emptyLabel ? (
            <div style={{ fontSize: 13, color: '#b0aea5' }}>{props.emptyLabel}</div>
        ) : null
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {props.items.map((item, idx) => {
                const text = item.text.trim().length > 0 ? item.text.trim() : '(empty)'
                return (
                    <div
                        key={item.id ?? String(idx)}
                        style={{
                            fontSize: 13,
                            color: checklistColor(item),
                            textDecoration: checklistTone(item)
                        }}
                    >
                        {checklistIcon(item)} {text}
                    </div>
                )
            })}
        </div>
    )
}
