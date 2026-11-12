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
 * 块级标记至少有一种才走富文本解析，其余原样插入。
 */
const BLOCK_START_PATTERNS: readonly RegExp[] = [
    /^ {0,3}#{1,6}\s/m, // 标题
    /^ {0,3}[-*+]\s/m, // 无序列表
    /^ {0,3}\d+\.\s/m, // 有序列表
    /^ {0,3}>\s/m, // 引用块
    /^ {0,3}(```|~~~)/m, // 围栏代码块
    /^ {0,3}\|.*\|\s*$/m, // GFM 表格行（首尾都有竖线）
]

/** 文本是否含 Markdown 块级结构（多行模式下任一行起始命中即真，整串扫描可短路） */
export function looksLikeMarkdownBlock(text: string): boolean {
    return BLOCK_START_PATTERNS.some((re) => re.test(text))
}
