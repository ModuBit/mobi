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

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { getToolResultViewComponent } from '@/components/tool-card/views/_results'
import type { ToolViewProps } from '@/components/tool-card/views/_all'
import type { ToolInfo } from '@/domain/tool/types'

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
)

/** 失败的文件编辑类工具：result 是错误信息，input 仍是「本想做的编辑」 */
function makeErrorProps(toolName: string, input: unknown): ToolViewProps {
    const tool: ToolInfo = {
        name: toolName,
        input,
        result: 'The file /tmp/x.ts does not match the old_string (offset mismatch)',
        state: 'error',
        description: null,
        startedAt: Date.now(),
        createdAt: Date.now(),
        permission: null,
    }
    return { block: { id: 'block-1', type: 'tool_use', tool } } as ToolViewProps
}

const EDIT_INPUT = {
    file_path: '/tmp/x.ts',
    old_string: 'const a = 1',
    new_string: 'const a = 2',
}

describe('文件编辑类工具失败时展示错误原因', () => {
    afterEach(cleanup)

    it.each(['Edit', 'MultiEdit', 'Write'])('%s：state=error → 展示 result 错误文本，不渲染 input 的 diff/写入内容', (toolName) => {
        const input = toolName === 'MultiEdit'
            ? { file_path: '/tmp/x.ts', edits: [{ old_string: 'const a = 1', new_string: 'const a = 2' }] }
            : toolName === 'Write'
                ? { file_path: '/tmp/x.ts', content: 'const a = 2' }
                : EDIT_INPUT
        const View = getToolResultViewComponent(toolName)
        const { container } = render(<View {...makeErrorProps(toolName, input)} />, { wrapper })

        expect(screen.getByText(/does not match the old_string/)).toBeInTheDocument()
        // input 的 diff/内容不再展示（那是「本想做的」，不是「实际发生的」）
        expect(container.textContent).not.toContain('const a = 2')
    })
})
