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

import CodeHighlight from './CodeHighlight'

interface TextContentViewProps {
    /** 文件文本内容 */
    text: string
    /** 文件路径（用于推断语言） */
    filePath: string
    /** 是否走 Shiki 高亮（< 1MB）；否则纯 <pre> */
    highlight: boolean
    /** 自动换行（默认 true）；false 时长行不换行，容器横向滚动 */
    wrap?: boolean
}

/**
 * 文本类文件内容视图（纯展示）：
 * - highlight：复用 CodeHighlight（Shiki 高亮，未加载语言时内部 fallback 纯 <pre>）
 * - 非 highlight：纯 <pre>，样式与 CodeHighlight fallback 对齐
 */
export default function TextContentView({ text, filePath, highlight, wrap = true }: TextContentViewProps) {
    return (
        <div className="text-content-view source-view">
            <div className="content-scroll">
                {highlight
                    ? <CodeHighlight code={text} filePath={filePath} wrap={wrap} />
                    : (
                        <pre style={{
                            fontSize: 12, margin: 0,
                            whiteSpace: wrap ? 'pre-wrap' : 'pre',
                            wordBreak: wrap ? 'break-all' : 'normal',
                            fontFamily: 'var(--font-mono)',
                        }}>
                            {text}
                        </pre>
                    )}
            </div>
        </div>
    )
}
