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

import type { ToolViewProps } from '@/components/ToolCard/views/_all'
import { isObject } from '@mobi/shared'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * ExitPlanMode 工具视图
 */
export function ExitPlanModeView(props: ToolViewProps) {
    const input = props.block.tool.input
    if (!isObject(input)) return null
    const plan = typeof input.plan === 'string' ? input.plan : null
    if (!plan) return null

    return (
        <div style={{ maxWidth: '100%' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {plan || ''}
            </ReactMarkdown>
        </div>
    )
}
