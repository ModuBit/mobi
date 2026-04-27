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

/**
 * Edit 工具视图
 */
export function EditView(props: ToolViewProps) {
    const input = props.block.tool.input
    if (!isObject(input)) return null

    const filePath = typeof input.file_path === 'string' ? input.file_path : null
    const oldString = typeof input.old_string === 'string' ? input.old_string : null
    const newString = typeof input.new_string === 'string' ? input.new_string : null
    if (oldString === null || newString === null) return null

    return (
        <DiffView
            oldString={oldString}
            newString={newString}
            filePath={filePath ?? undefined}
            variant="inline"
            statsType="edit"
        />
    )
}
