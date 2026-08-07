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

import { describe, it, expect, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render } from '@testing-library/react'

// mock uiStore：useUiStore(selector) → selector({theme:'light'})；resolveTheme 透传
vi.mock('@/core/data/stores/uiStore', () => ({
    useUiStore: (selector: (s: { theme: string }) => unknown) => selector({ theme: 'light' }),
    resolveTheme: (t: string) => t,
}))

import { CodeEditorView } from '@/components/files/CodeEditorView'

describe('CodeEditorView', () => {
    it('渲染 CodeMirror 编辑器（.cm-editor 存在）', () => {
        render(<CodeEditorView text="hello" filePath="a.ts" onChange={() => {}} wrap={false} />)
        expect(document.querySelector('.cm-editor')).toBeInTheDocument()
    })

    it('filePath 变化不崩（重建 editor）', () => {
        const { rerender } = render(
            <CodeEditorView text="x" filePath="a.ts" onChange={() => {}} wrap={false} />,
        )
        rerender(<CodeEditorView text="x" filePath="b.md" onChange={() => {}} wrap={false} />)
        expect(document.querySelector('.cm-editor')).toBeInTheDocument()
    })

    it('未知扩展名不崩（纯文本，无语言包）', () => {
        render(<CodeEditorView text="x" filePath="unknown.xyz" onChange={() => {}} wrap={false} />)
        expect(document.querySelector('.cm-editor')).toBeInTheDocument()
    })
})
