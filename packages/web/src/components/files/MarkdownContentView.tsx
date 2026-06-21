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

import { Markdown } from '@/components/ui/Markdown'
import CodeHighlight from './CodeHighlight'

interface MarkdownContentViewProps {
    /** Markdown 文本内容 */
    text: string
    /** 文件路径（用于源码模式高亮） */
    filePath: string
    /** 渲染模式：render 渲染 / source 源码高亮（toggle state 由外壳持有） */
    view: 'render' | 'source'
}

/**
 * Markdown 文件内容视图（纯展示）：
 * - render：XMarkdown 渲染
 * - source：源码 Shiki 高亮（复用 CodeHighlight）
 */
export default function MarkdownContentView({ text, filePath, view }: MarkdownContentViewProps) {
    return view === 'render'
        ? <Markdown content={text} />
        : <CodeHighlight code={text} filePath={filePath} />
}
