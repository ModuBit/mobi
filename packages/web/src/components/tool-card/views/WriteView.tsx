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
 * Write 工具视图
 */
export function WriteView(props: ToolViewProps) {
    const input = props.block.tool.input
    if (!isObject(input)) return null

    const filePath = typeof input.file_path === 'string' ? input.file_path : null
    const content = typeof input.content === 'string' ? input.content : typeof input.text === 'string' ? input.text : null
    if (content === null) return null

    return (
        <DiffView
            oldString=""
            newString={content}
            filePath={filePath ?? undefined}
            variant="inline"
            statsType="write"
        />
    )
}
