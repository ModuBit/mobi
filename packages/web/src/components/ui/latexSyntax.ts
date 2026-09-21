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
 * LaTeX 定界语法归一（Streamdown 新栈用）
 *
 * Streamdown 的 math 插件（remark-math）只认 `$...$` / `$$...$$`；mobi 历史内容
 * 面向旧栈 marked 插件，还产出自研定界 `\(...\)` 与 `\[...\]`。本模块在喂
 * Streamdown 前做一层轻量文本归一，把四种语法面收敛为 remark-math 认识的形态：
 * - `\(...\)`（无换行）→ `$...$`
 * - `\(...\)`（含换行，remark-math 行内规则不跨行）→ 独立成段的 `$$...$$`
 * - `\[...\]` → 独立成段的 `$$...$$`
 * - 数学内容内的 `{align*}` → `{aligned}`（katex 不支持 align*，沿旧栈 replaceAlign 修正）
 *
 * fenced code block 与行内 code 内的定界符不属于公式，原样保留（掩码保护）。
 */

/** 数学体内修正：katex 不支持 align* 环境（沿旧栈 replaceAlign） */
function replaceAlign(text: string): string {
    return text.replace(/\{align\*\}/g, '{aligned}')
}

/**
 * 跨行单 `$` 对转义（旧栈「行内不跨行」核心修复的平移）。
 *
 * remark-math 的行内 `$...$` 允许跨行（与旧栈 marked 插件 `[^\n$]` 规则不同），
 * 会让 `$0.2290\n正文\n$` 这类跨段美元符号对被误吃成公式。此处把「内容含换行、
 * 且内部无其他 `$` 的单 `$` 对」整体转义为 `\$`（remark-math 视为字面量）；
 * `$$` 块级公式经两端 (?!\$) 与内容无 `$` 双重排除，不受影响。
 *
 * 先掩码合法的单行 `$...$` 对再处理，避免「前一公式的闭合 $」与后方孤立 `$`
 * 被拼成一个跨行对（贪婪回溯的误配）。
 */
function escapeCrossLineSingleDollars(text: string): string {
    const pairs: string[] = []
    // 单行对判定含 remark-math 的空白规则：公式内容首尾不能是空白
    // （`$ 与公式 $` 这类不算公式对，否则会吃掉后面真正的公式开 $）
    const masked = text.replace(/(?<!\$)\$(?!\$)([^\n$\s](?:[^\n$]*[^\n\s$])?)\$(?!\$)/g, (m, _inner: string) => {
        pairs.push(m)
        return `\uE001${pairs.length - 1}\uE001`
    })
    const escaped = masked.replace(/\$(?!\$)([^$\n\uE001]*\n[^$\uE001]*?)\$(?!\$)/g, (_m, inner: string) => `\\$${inner}\\$`)
    return escaped.replace(/\uE001(\d+)\uE001/g, (_m, i: string) => pairs[Number(i)])
}

export function normalizeLatexSyntax(content: string): string {
    // 掩码保护 code 区段：占位符不会被任何定界规则误伤（私用区字符 \uE000/\uE001 不出现在正文中，也不触发 no-control-regex）
    const segments: string[] = []
    const mask = (m: string) => `\uE000${segments.push(m) - 1}\uE000`
    const masked = content
        .replace(/```[\s\S]*?```/g, mask)
        .replace(/~~~[\s\S]*?~~~/g, mask)
        .replace(/`[^`\n]*`/g, mask)

    const converted = escapeCrossLineSingleDollars(masked)
        // \(...\)：单行 → 行内 $...$；跨行 → 独立成段的 $$...$$（remark-math 行内不跨行）
        .replace(/\\\(([\s\S]*?)\\\)/g, (_m, tex: string) =>
            tex.includes('\n') ? `\n$$\n${replaceAlign(tex)}\n$$\n` : `$${replaceAlign(tex)}$`)
        // \[...\]：块级 → 独立成段的 $$...$$
        .replace(/\\\[([\s\S]*?)\\\]/g, (_m, tex: string) => `\n$$\n${replaceAlign(tex)}\n$$\n`)

    return converted.replace(/\uE000(\d+)\uE000/g, (_m, i: string) => segments[Number(i)])
}
