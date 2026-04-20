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

import type { ToolViewProps } from '@/components/tool-card/views/_all'
import { isObject } from '@mobi/shared'
import { DiffView } from '@/components/tool-card/views/DiffView'

type Edit = { old_string: string; new_string: string }

const MAX_COMPACT_EDITS = 3

function extractEdits(input: unknown): Edit[] {
    if (!isObject(input) || !Array.isArray(input.edits)) return []
    return input.edits
        .filter(isObject)
        .map((edit) => ({
            old_string: typeof edit.old_string === 'string' ? edit.old_string : '',
            new_string: typeof edit.new_string === 'string' ? edit.new_string : ''
        }))
        .filter((edit) => edit.old_string.length > 0 || edit.new_string.length > 0)
}

/**
 * MultiEdit 紧凑视图
 */
export function MultiEditView(props: ToolViewProps) {
    const edits = extractEdits(props.block.tool.input)
    if (edits.length === 0) return null

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {edits.slice(0, MAX_COMPACT_EDITS).map((edit, idx) => (
                <DiffView
                    key={idx}
                    oldString={edit.old_string}
                    newString={edit.new_string}
                />
            ))}
            {edits.length > MAX_COMPACT_EDITS ? (
                <div style={{ fontSize: 12, color: '#999' }}>
                    (+{edits.length - MAX_COMPACT_EDITS} more edits)
                </div>
            ) : null}
        </div>
    )
}

/**
 * MultiEdit 完整视图
 */
export function MultiEditFullView(props: ToolViewProps) {
    const edits = extractEdits(props.block.tool.input)
    if (edits.length === 0) return null

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {edits.map((edit, idx) => (
                <DiffView
                    key={idx}
                    oldString={edit.old_string}
                    newString={edit.new_string}
                    variant="inline"
                />
            ))}
        </div>
    )
}
