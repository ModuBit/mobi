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

import { theme as antTheme } from 'antd'
import type { ToolViewProps } from '@/components/tool-card/views/_all'
import { getInputStringAny } from '@/core/lib/toolInputUtils'
import { extractTextFromResult, placeholderForState } from './_results'
import { ToolViewPanel } from './ToolViewPanel'

const { useToken } = antTheme

/** Glob 工具视图 */
export function GlobView(props: ToolViewProps) {
    const { token } = useToken()
    const { input, result, state } = props.block.tool

    const pattern = getInputStringAny(input, ['pattern'])
    const isFinished = state === 'completed' || state === 'error'
    const output = isFinished ? extractTextFromResult(result) : null

    return (
        <ToolViewPanel header={pattern || undefined}>
            {output ? (
                <div style={{
                    padding: '4px 10px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: token.colorText,
                    whiteSpace: 'pre',
                    overflowX: 'auto',
                }}>
                    {output}
                </div>
            ) : (
                <div style={{ padding: '6px 10px', fontSize: 12, color: token.colorTextTertiary }}>
                    {placeholderForState(state)}
                </div>
            )}
        </ToolViewPanel>
    )
}
