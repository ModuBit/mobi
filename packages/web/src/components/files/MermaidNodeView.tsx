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

import { memo } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { MermaidDiagram } from '@/components/ui/MermaidDiagram'

/**
 * 编辑器内 mermaid codeBlock 的 ReactNodeView。
 * memo：node 内容不变时不重渲染（避免 ProseMirror selection 变化触发重算 mermaid）。
 */
export const MermaidNodeView = memo(function MermaidNodeView({ node }: NodeViewProps) {
    return (
        <NodeViewWrapper>
            <MermaidDiagram code={node.textContent} />
        </NodeViewWrapper>
    )
})
