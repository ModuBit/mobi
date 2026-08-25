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
 * 流式 Markdown 的稳定前缀拆分（增量渲染的基石）。
 *
 * ## 为什么
 *
 * XMarkdown 对 content 全量 parse + 全量重建元素树（其内部 useMemo 依赖整个
 * content 字符串）。流式逐字期间每帧 content 变化 → 整个回复（含早已完成的
 * 段落）每帧被重新 parse / 重新 render / 全树 reconcile——长回复的每帧成本
 * 随长度线性增长。把「确定不会再变的完成块」（稳定前缀）与「仍在变化的尾部」
 * 拆开后，稳定前缀渲染成独立的 memo 子树（content 值不变 → 零 re-parse 零
 * re-render），每帧只有尾部小块参与 parse——这就是「只 touch 仍在变化的部分」。
 *
 * ## 拆分规则（保守优先：宁可少切，不可切错）
 *
 * 切点只能落在**块级边界**（空行序列的行尾），且扫描至切点必须满足：
 * - 不在未闭合 code fence 内（fence 内的空行是代码内容，不是块边界）
 * - 前一个「延续块」已终止。延续块指跨空行延续的结构：
 *   - 列表（marker 行 / 缩进续行；列表项间空行仍属同一列表——切开会导致
 *     ol 编号重置与间距断裂）。终止 = 出现非空、非 marker、非缩进的行
 *   - HTML 块（`<` 开头行）：一旦出现，其后整个文本不再设切点——HTML 块
 *     内空行的语义不可靠，而 markdown 回复中 HTML 块罕见，保守损失极小
 * - 引用块（`>`）**不算**延续块：markdown 规范中空行结束 quote 块，
 *   quote 后空行可安全切
 * - 表格天然安全：表内不允许空行，空行必在表外
 * - setext 标题（下划线式）天然安全：标题与下划线间无空行，切不进去
 *
 * 输出不变式：`stable + tail === text`（纯位置切割，两段拼回原文）。
 * 无安全切点时 stable=''（全部进 tail，退化为整段流式渲染）。
 */

export interface StableSplit {
    /** 完成块前缀（含其后的空行）；流式期间单调增长，值不变即无需重渲染 */
    stable: string
    /** 仍在变化的尾部（当前流式的段落/代码块/列表/表格） */
    tail: string
}

/** code fence 起始/结束行（``` 或 ~~~，容忍 ≤3 空格缩进） */
const FENCE_RE = /^\s{0,3}(```|~~~)/

/** 列表 marker 行（- / * / + / 1. / 1) 后接内容或空 marker） */
const LIST_MARKER_RE = /^\s{0,3}([-+*]|\d+[.)])(\s|$)/

/** HTML 块起始行（`<` 后跟字母） */
const HTML_BLOCK_RE = /^\s*<\/?[a-zA-Z]/

/** 缩进续行（任意非 tab 缩进的非空行——lazy continuation / 列表续行保守归并） */
const INDENTED_RE = /^[ \t]+\S/

/**
 * 把流式文本拆成「稳定前缀 + 活动尾部」。
 * 取**最后一个**安全切点，使 stable 尽量大（尾部 parse 成本最小化）。
 */
export function splitStablePrefix(text: string): StableSplit {
    // 快路径：无空行必无块边界，整段 tail（流式开头最常见形态）
    if (!text.includes('\n\n')) return { stable: '', tail: text }

    let inFence = false
    /** 延续块（列表/HTML）进行中：此状态下空行不设切点 */
    let continuationActive = false
    /** HTML 块已出现：其后永久不切（保守，见模块注释） */
    let htmlSeen = false
    /** 当前空行序列结束后的候选切点 offset（-1 = 无候选） */
    let pendingCut = -1
    /** 已提交的最后安全切点 */
    let cut = -1
    /** 首个非空行 offset：切点不早于它（之前全是空白，无完成块可稳定） */
    let firstContentOffset = -1

    const len = text.length
    let lineStart = 0
    while (lineStart <= len) {
        // 行内容 [lineStart, lineEnd)，换行符在 lineEnd（可能不存在——末行）
        let lineEnd = text.indexOf('\n', lineStart)
        if (lineEnd === -1) lineEnd = len
        const line = text.slice(lineStart, lineEnd)
        // 切点 offset = 行的换行符之后（末行无换行即文本尾）——保证 stable 完整
        // 含空行序列的换行，tail 从下一行开始
        const nextLineOffset = lineEnd < len ? lineEnd + 1 : len

        const isBlank = line.trim() === ''

        if (isBlank) {
            // 空行是候选块边界——fence 内 / 延续块中 / HTML 已出现时不可切
            pendingCut = (!inFence && !continuationActive && !htmlSeen) ? nextLineOffset : -1
        } else {
            if (firstContentOffset === -1) firstContentOffset = lineStart
            const isFence = FENCE_RE.test(line)
            if (isFence) {
                // fence 开行同时是一个新块的开始（此前空行的候选切点转正）
                if (pendingCut >= 0 && !inFence) cut = pendingCut
                inFence = !inFence
                continuationActive = false
            } else if (!inFence) {
                const isHtml = HTML_BLOCK_RE.test(line)
                const isContinuation = LIST_MARKER_RE.test(line)
                    || INDENTED_RE.test(line)
                    || isHtml

                if (isContinuation) {
                    // 延续块的**首行**是新块开始：此前空行是真正的块边界，候选切点
                    // 转正（此后 htmlSeen / continuationActive 生效，块内部不再可切）
                    if (pendingCut >= 0 && !continuationActive) cut = pendingCut
                    continuationActive = true
                    pendingCut = -1
                    if (isHtml) htmlSeen = true
                } else {
                    // 普通块行（段落/表格/quote/setext…）：
                    // 到达此行证明前面的空行是真正的块边界——候选切点转正
                    if (pendingCut >= 0 && !continuationActive) cut = pendingCut
                    continuationActive = false
                    pendingCut = -1
                }
            }
            // fence 内非 fence 行：状态全部冻结（pendingCut 已是 -1，空行分支不会设置）
        }

        if (lineEnd >= len) break
        lineStart = lineEnd + 1
    }

    // 文本以空行结尾：末尾空行序列也是合法块边界（全文完成，tail 为空）
    if (pendingCut >= 0 && !inFence && !continuationActive && !htmlSeen) {
        cut = pendingCut
    }

    // 全文无内容行（纯空白）或切点之前无完成块：不切
    if (cut <= 0 || firstContentOffset === -1 || cut <= firstContentOffset) {
        return { stable: '', tail: text }
    }
    return { stable: text.slice(0, cut), tail: text.slice(cut) }
}
