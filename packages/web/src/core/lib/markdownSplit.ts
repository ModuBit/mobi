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
 * - 不在未闭合 code fence 内（fence 内的空行是代码内容，不是块边界）。
 *   fence 闭合遵循 CommonMark：闭合行必须与开栏行**同字符**且长度 ≥ 开栏长度
 *   且仅尾随空白——嵌套展示场景（```` 包裹内含 ``` 的 markdown 示例）中，
 *   内层 ``` 不会提前闭合外层 fence
 * - 前一个「延续块」已终止。延续块指跨空行延续的结构（空行不结束、遇非空
 *   非缩进非 marker/tag 行才结束）：
 *   - 列表（marker 行 / 缩进续行；列表项间空行仍属同一列表——切开会导致
 *     ol 编号重置与间距断裂）
 *   - HTML 块（合法 tag 形态的行，见 HTML_TAG_RE；切开会拆散标签结构）。
 *     注意只匹配**完整 tag 形态**（`<div>`、`</div>`、`<div class>`），
 *     autolink（`<https://…>`、`<user@host>`，tag name 后跟 `:`/`@` 等）
 *     不是 HTML 块，不得误锁
 * - 引用块（`>`）**不算**延续块：markdown 规范中空行结束 quote 块，
 *   quote 后空行可安全切
 * - 表格天然安全：表内不允许空行，空行必在表外
 * - setext 标题（下划线式）天然安全：标题与下划线间无空行，切不进去
 *
 * 输出不变式：`stable + tail === text`（纯位置切割，两段拼回原文）。
 * 无安全切点时 stable=''（全部进 tail，退化为整段流式渲染）。
 *
 * ## 增量恢复（prevStable）
 *
 * 流式期间每帧调用（60-120Hz），全量逐行重扫会随消息长度线性变贵。切点处
 * 状态必为「干净」（不在 fence、不在延续块——这是切点成立的前提），因此从
 * 上帧切点以干净状态重扫与全量扫描**结果等价**，每帧成本 O(尾部) 而非 O(全文)。
 * prevStable 非空且是 text 前缀时启用；否则（文本收缩 / 全新内容）自动回退全量。
 */

export interface StableSplit {
    /** 完成块前缀（含其后的空行）；流式期间单调增长，值不变即无需重渲染 */
    stable: string
    /** 仍在变化的尾部（当前流式的段落/代码块/列表/表格） */
    tail: string
}

/** code fence 开栏行（捕获 marker 与剩余部分；容忍 ≤3 空格缩进） */
const FENCE_OPEN_RE = /^\s{0,3}(`{3,}|~{3,})(.*)$/

/** 列表 marker 行（- / * / + / 1. / 1) 后接内容或空 marker） */
const LIST_MARKER_RE = /^\s{0,3}([-+*]|\d+[.)])(\s|$)/

/**
 * HTML 块行：`<` + tag name +（空白 | `>` | `/>` | 行尾）。
 * 只认完整 tag 形态——autolink（`<https://…>`、`<user@host>`）的 tag name
 * 后跟 `:` / `@` 等，不构成 HTML 块，不得把后续整条消息锁进 tail
 */
const HTML_TAG_RE = /^<\/?[a-zA-Z][a-zA-Z0-9-]*(?=[\s>/]|$)/

/** 缩进续行（任意缩进的非空行——lazy continuation / 列表续行保守归并） */
const INDENTED_RE = /^[ \t]+\S/

/** fence 闭栏判定：同字符、长度 ≥ 开栏长度、仅尾随空白（CommonMark） */
function isFenceClose(trimmed: string, ch: string, openLen: number): boolean {
    let i = 0
    while (i < trimmed.length && trimmed[i] === ch) i++
    if (i < openLen) return false
    return trimmed.slice(i).trim() === ''
}

/**
 * 把流式文本拆成「稳定前缀 + 活动尾部」。
 * 取**最后一个**安全切点，使 stable 尽量大（尾部 parse 成本最小化）。
 *
 * @param prevStable 上一帧的 stable（增量恢复锚点，见模块注释；可选）
 */
export function splitStablePrefix(text: string, prevStable?: string): StableSplit {
    // 增量恢复：prevStable 是前缀时从切点续扫（状态干净，等价全量）
    let resumeOffset = 0
    if (prevStable && prevStable.length > 0 && text.startsWith(prevStable)) {
        resumeOffset = prevStable.length
    }

    // 快路径（仅全量模式）：无空行必无块边界，整段 tail（流式开头最常见形态）
    if (resumeOffset === 0 && !text.includes('\n\n')) return { stable: '', tail: text }

    let inFence = false
    let fenceCh = ''
    let fenceLen = 0
    /** 延续块（列表/HTML）进行中：此状态下空行不设切点 */
    let continuationActive = false
    /** 当前空行序列结束后的候选切点 offset（-1 = 无候选） */
    let pendingCut = -1
    /** 已提交的最后安全切点（增量模式下以起点为初值——stable 单调不减） */
    let cut = resumeOffset > 0 ? resumeOffset : -1
    /** 首个非空行 offset：切点不早于它（之前全是空白，无完成块可稳定） */
    let firstContentOffset = resumeOffset > 0 ? 0 : -1

    const len = text.length
    let lineStart = resumeOffset
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
            // 空行是候选块边界——fence 内 / 延续块中不可切
            pendingCut = !inFence && !continuationActive ? nextLineOffset : -1
        } else if (inFence) {
            // fence 内：仅闭栏行翻转状态（嵌套的内层短 fence 不算闭合）
            if (isFenceClose(line.trim(), fenceCh, fenceLen)) {
                inFence = false
                fenceCh = ''
                fenceLen = 0
            }
        } else {
            if (firstContentOffset === -1) firstContentOffset = lineStart

            const fenceOpen = FENCE_OPEN_RE.exec(line)
            // CommonMark：backtick fence 的 info string 不得含 backtick（否则非 fence）
            if (fenceOpen && !(fenceOpen[1][0] === '`' && fenceOpen[2].includes('`'))) {
                // fence 开行是新块开始：此前空行的候选切点转正
                if (pendingCut >= 0 && !continuationActive) cut = pendingCut
                inFence = true
                fenceCh = fenceOpen[1][0]
                fenceLen = fenceOpen[1].length
                continuationActive = false
                pendingCut = -1
            } else {
                const isContinuation = LIST_MARKER_RE.test(line)
                    || INDENTED_RE.test(line)
                    || HTML_TAG_RE.test(line)

                if (isContinuation) {
                    // 延续块的**首行**是新块开始：此前空行是真正的块边界，候选切点
                    // 转正（此后 continuationActive 生效，块内部不再可切）
                    if (pendingCut >= 0 && !continuationActive) cut = pendingCut
                    continuationActive = true
                    pendingCut = -1
                } else {
                    // 普通块行（段落/表格/quote/setext…）：
                    // 到达此行证明前面的空行是真正的块边界——候选切点转正
                    if (pendingCut >= 0 && !continuationActive) cut = pendingCut
                    continuationActive = false
                    pendingCut = -1
                }
            }
        }

        if (lineEnd >= len) break
        lineStart = lineEnd + 1
    }

    // 文本以空行结尾：末尾空行序列也是合法块边界（全文完成，tail 为空）
    if (pendingCut >= 0 && !inFence && !continuationActive) {
        cut = pendingCut
    }

    // 全文无内容行（纯空白）或切点之前无完成块：不切
    if (cut <= 0 || firstContentOffset === -1 || cut <= firstContentOffset) {
        return { stable: '', tail: text }
    }
    return { stable: text.slice(0, cut), tail: text.slice(cut) }
}
