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

import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewRendererProps } from '@tiptap/core'
import { MermaidNodeView } from './MermaidNodeView'

/**
 * CodeBlockLowlight 扩展：codeBlock 的 NodeView 按 language 分流——
 * - language=mermaid → MermaidNodeView（渲染 mermaid 图）
 * - 其他 → null（ProseMirror 默认 codeBlock 渲染，lowlight decoration 仍生效做语法高亮）
 *
 * 序列化仍走 codeBlock（```mermaid 围栏），@tiptap/markdown 原生双向。
 */
export const CodeBlockWithMermaid = CodeBlockLowlight.extend({
    addNodeView() {
        const mermaidRenderer = ReactNodeViewRenderer(MermaidNodeView)
        type NodeView = NonNullable<ReturnType<typeof mermaidRenderer>>
        return (props: NodeViewRendererProps): NodeView => {
            if (props.node.attrs.language === 'mermaid') {
                return mermaidRenderer(props) as NodeView
            }
            // 非 mermaid：返回 null → ProseMirror 默认渲染 pre/code，
            // lowlight 的语法高亮通过 decoration 生效（不依赖 NodeView）
            return null as unknown as NodeView
        }
    },
})
