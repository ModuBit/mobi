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

/**
 * 粘贴纯文本时的 Markdown 判定。
 *
 * 只认**块级**起始标记：行内标记（`**x**`、`*x*`、`` `x` ``）不触发转换——
 * 否则粘贴代码（`const a = 2 ** 3`、JS 注释）会被当成 Markdown 渲染，语义被吃掉。
 *
 * 判定分两档，避免把普通代码/日志误判成 Markdown：
 * - 强标记（围栏代码块 / GFM 表格）在任意行出现即认定；
 * - 弱标记（标题 / 列表 / 引用）只认**首个非空行**——代码里的行首注释（`# TODO`）、
 *   diff 的 `+ 新增` / `- 删除` 都在后续行，不应触发整段富文本化。
 */
const STRONG_BLOCK_PATTERNS: readonly RegExp[] = [
    /^ {0,3}(```|~~~)/m, // 围栏代码块
    /^ {0,3}\|.*\|\s*$/m, // GFM 表格行（首尾都有竖线）
]

const FIRST_LINE_BLOCK_PATTERNS: readonly RegExp[] = [
    /^ {0,3}#{1,3}\s/, // 标题（composer Heading 仅支持 h1–h3，h4+ 原样插入）
    /^ {0,3}[-*+]\s/, // 无序列表
    /^ {0,3}\d+\.\s/, // 有序列表
    /^ {0,3}>\s/, // 引用块
]

/** 文本是否含 Markdown 块级结构（强标记整串扫描；弱标记只看首个非空行） */
export function looksLikeMarkdownBlock(text: string): boolean {
    if (STRONG_BLOCK_PATTERNS.some((re) => re.test(text))) return true
    const firstLine = text.trimStart().split('\n', 1)[0] ?? ''
    return FIRST_LINE_BLOCK_PATTERNS.some((re) => re.test(firstLine))
}
