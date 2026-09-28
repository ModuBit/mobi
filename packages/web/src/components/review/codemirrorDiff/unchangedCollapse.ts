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
 * 未变更区折叠（自研替换原生 collapseUnchanged）：原生 CollapseWidget 点击展开是
 * 单向的（CollapsedRanges 只删不增），无法折回。自研同款算法（margin 3 / minSize 5
 * 与原配置一致）+ 可逆状态：expandedUnchanged 存已展开区的起点集合，doc 只读不变、
 * 位置恒定。展开/收起全程由同一个块 widget 承载（head 折叠条/芯片 + 行内容自渲染），
 * 以 grid-template-rows auto 0fr↔auto 1fr 成对过渡（DESIGN.md Motion：双向缓动、
 * 可打断、时长曲线走 antd token、prefers-reduced-motion 降级瞬时），样式见
 * antd.css「未变更区折叠」段。
 *
 * 区间推导算法抽成纯函数 computeUnchangedRanges（jsdom 单测覆盖边界），DOM/装饰
 * 组装留在本文件——脆弱点（区间边界）与机制（widget 过渡）分层。
 */

import { EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { getChunks } from '@codemirror/merge'

/** 展开/折回某段未变更区（值 = 该区第一行的行首位置） */
const expandUnchanged = StateEffect.define<number>()
const recollapseUnchanged = StateEffect.define<number>()

const UNCHANGED_MIN_SIZE = 5
const UNCHANGED_MARGIN = 3

/** 未变更区折叠开关。展开/收起动画与 CM heightMap/gutter 同步的真机问题未收敛，
 *  暂时禁用交互——折叠条照常收起呈现（视觉不变），点击不展开/不折回，待续 */
const ENABLE_UNCHANGED_COLLAPSE = true
const UNCHANGED_INTERACTIVE = false

/** lucide fold-vertical / unfold-vertical 的 SVG 投影（widget 手工建 DOM，走 currentColor） */
const FOLD_VERTICAL_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22v-6"/><path d="M12 8V2"/><path d="M4 12H2"/><path d="M10 12H8"/><path d="M16 12h-2"/><path d="M22 12h-2"/><path d="m15 19-3-3-3 3"/><path d="m15 5-3 3-3-3"/></svg>'
const UNFOLD_VERTICAL_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22v-6"/><path d="M12 8V2"/><path d="M4 12H2"/><path d="M10 12H8"/><path d="M16 12h-2"/><path d="M22 12h-2"/><path d="m15 19-3 3-3-3"/><path d="m15 5-3-3-3 3"/></svg>'

/**
 * 纯函数：由 chunk 的 B 侧行跨度推导「可折叠未变更区」列表。
 * 规则：相邻 chunk 之间留 UNCHANGED_MARGIN 行上下文；首 chunk 前不留；尾部到文档末行；
 * 仅行数 ≥ UNCHANGED_MIN_SIZE 的区段产出。
 */
export function computeUnchangedRanges(
    chunkLineSpans: ReadonlyArray<{ from: number; to: number }>,
    totalLines: number,
): Array<{ fromLine: number; toLine: number }> {
    const out: Array<{ fromLine: number; toLine: number }> = []
    let prevLine = 1
    for (let i = 0; ; i++) {
        const span = i < chunkLineSpans.length ? chunkLineSpans[i] : null
        const collapseFrom = i ? prevLine + UNCHANGED_MARGIN : 1
        const collapseTo = span ? span.from - 1 - UNCHANGED_MARGIN : totalLines
        if (collapseTo - collapseFrom + 1 >= UNCHANGED_MIN_SIZE) {
            out.push({ fromLine: collapseFrom, toLine: collapseTo })
        }
        if (!span) break
        prevLine = span.to
    }
    return out
}

function el(tag: string, className: string, text?: string): HTMLElement {
    const node = document.createElement(tag)
    node.className = className
    if (text !== undefined) node.textContent = text
    return node
}

/** 未变更区容器 widget：覆盖整个 gap（收起/展开都是它，保证过渡在同一个 DOM 上发生）。
 *  eq 只看区间（位置与行数）→ CM 复用 DOM；展开态翻转走 updateDOM 只切 class，
 *  CSS 过渡从当前值反向进行——动画中途再次点击即平滑折返，天然可打断 */
class UnchangedRegionWidget extends WidgetType {
    constructor(
        private readonly start: number,
        private readonly fromLine: number,
        private readonly toLine: number,
        private readonly expanded: boolean,
        private readonly label: (n: number) => string,
        private readonly chipLabel: string,
    ) { super() }

    get lineCount() { return this.toLine - this.fromLine + 1 }

    eq(other: UnchangedRegionWidget) {
        // ⚠️ 必须包含 expanded：CM 的 findWidget 在 compare(=eq) 相等时直接复用旧 DOM、
        // 不调 updateDOM；updateDOM 只在 eq 不等但构造器相同时才被征询（实证）。
        // 展开态不同 → eq false → 走 updateDOM 在原 DOM 上翻转 class（CSS 过渡生效）
        return other.start === this.start && other.fromLine === this.fromLine
            && other.toLine === this.toLine && other.expanded === this.expanded
    }

    toDOM(view: EditorView) {
        const root = el('div', `cm-unchanged ${this.expanded ? 'cm-unchanged-expanded' : 'cm-unchanged-collapsed'}`)
        const head = el('div', 'cm-unchanged-head')
        head.append(this.expanded ? this.buildChip(view) : this.buildBar(view))
        const clip = el('div', 'cm-unchanged-clip')
        // 行号 span 负偏移到 gutter 列，但 clip 的 overflow:hidden 会把越出左缘的部分裁掉——
        // 把 clip 用「负 margin + 等量 padding」向左扩过一个 gutter 宽度，数字落回裁剪框内；
        // padding 抵消 margin，正文列对齐不受影响
        const gutterW = view.dom.querySelector<HTMLElement>('.cm-gutters')?.getBoundingClientRect().width ?? 48
        const extend = `${Math.ceil(gutterW) + 16}px`
        root.style.setProperty('--cm-unchanged-extend', extend)
        const body = el('div', 'cm-unchanged-body')
        if (this.expanded) this.buildRows(body, view)
        clip.append(body)
        root.append(head, clip)
        return root
    }

    updateDOM(dom: HTMLElement, view: EditorView) {
        dom.classList.toggle('cm-unchanged-expanded', this.expanded)
        dom.classList.toggle('cm-unchanged-collapsed', !this.expanded)
        const body = dom.querySelector<HTMLElement>('.cm-unchanged-body')!
        // 展开需要行内容参与高度过渡：懒构建（收起态不占 DOM，大 gap 零常驻成本）
        if (this.expanded && !body.dataset.built) this.buildRows(body, view)
        const head = dom.querySelector<HTMLElement>('.cm-unchanged-head')!
        head.replaceChildren(this.expanded ? this.buildChip(view) : this.buildBar(view))
        // 高度随过渡逐帧变化：强制 CM 逐帧重测内容高度，heightMap/gutter 才能跟随。
        // ⚠️ 仅 requestMeasure 不够——本视图为面板内滚动覆写了 content height:100%，
        // contentDOM rect 恒定，CM 的「rect 差值」检测永不触发；mustMeasureContent 是
        // 内部字段，是这里唯一可靠的强制重测通道（实证：不置它，收起后 gutter 永久错位）
        ;(view as unknown as { viewState: { mustMeasureContent: boolean } }).viewState.mustMeasureContent = true
        view.requestMeasure()
        const nudge = () => {
            ;(view as unknown as { viewState: { mustMeasureContent: boolean } }).viewState.mustMeasureContent = true
            view.requestMeasure()
        }
        const id = window.setInterval(nudge, 16)
        const stop = () => window.clearInterval(id)
        dom.addEventListener('transitionend', stop, { once: true })
        // reduced-motion 等不触发 transitionend 的场景兜底（时长 ~ token 0.2s，取富余）
        window.setTimeout(stop, 800)
        return true
    }

    /** 折叠条：图标落 gutter 列 + 「N 行未变更」+ 发丝线补位，点击展开 */
    private buildBar(view: EditorView): HTMLElement {
        const bar = this.buildHead(FOLD_VERTICAL_SVG, this.label(this.lineCount))
        bar.addEventListener('click', () => {
            if (UNCHANGED_INTERACTIVE) view.dispatch({ effects: expandUnchanged.of(this.start) })
        })
        return bar
    }

    /** 折回芯片：图标 + 「收起未变更行」，点击折回 */
    private buildChip(view: EditorView): HTMLElement {
        const chip = this.buildHead(UNFOLD_VERTICAL_SVG, this.chipLabel, 'cm-recollapse-chip')
        chip.setAttribute('aria-label', this.chipLabel)
        chip.addEventListener('click', () => {
            if (UNCHANGED_INTERACTIVE) view.dispatch({ effects: recollapseUnchanged.of(this.start) })
        })
        return chip
    }

    /** head 通用骨架：图标落 gutter 列 + 文字 + 发丝线；交互禁用时去手型、hover 不点亮 */
    private buildHead(svg: string, text: string, cls = 'cm-collapse-bar'): HTMLElement {
        const head = el('div', cls)
        head.title = text
        const icon = el('span', 'cm-collapse-icon')
        icon.innerHTML = svg
        head.append(icon, el('span', 'cm-collapse-label', text), el('span', 'cm-collapse-rule'))
        if (!UNCHANGED_INTERACTIVE) head.classList.add('cm-unchanged-static')
        return head
    }

    /** 行内容自渲染：文本/换行度量从真实 .cm-line 拷贝，保证与上下文行视觉一致；
     *  行号 span 负偏移到 gutter 列（gap 行在真实 gutter 里没有单元格） */
    private buildRows(body: HTMLElement, view: EditorView) {
        body.dataset.built = '1'
        const realLine = view.dom.querySelector<HTMLElement>('.cm-line')
        if (realLine) {
            const cs = getComputedStyle(realLine)
            body.style.whiteSpace = cs.whiteSpace
            body.style.overflowWrap = cs.overflowWrap
            body.style.wordBreak = cs.wordBreak
            body.style.tabSize = cs.tabSize
        }
        for (let n = this.fromLine; n <= this.toLine; n++) {
            const row = el('div', 'cm-unchanged-line')
            // 行号 = after 侧行号（doc 行号），与折叠条上方/下方的真实 gutter 数字连续
            row.append(
                el('span', 'cm-unchanged-no', String(n)),
                document.createTextNode(view.state.doc.line(n).text),
            )
            body.append(row)
        }
    }

    ignoreEvent() { return true }
}

/** 已展开的未变更区起点集合（doc 只读 → 位置恒定） */
const expandedUnchanged = StateField.define<readonly number[]>({
    create: () => [],
    update(expanded, tr) {
        let next = expanded
        for (const e of tr.effects) {
            if (e.is(expandUnchanged)) {
                if (!next.includes(e.value)) next = [...next, e.value]
            } else if (e.is(recollapseUnchanged)) {
                next = next.filter((p) => p !== e.value)
            }
        }
        return next
    },
})

/** 折叠装饰：chunk 间隙 ≥ minSize 行 → 整段交给 UnchangedRegionWidget（收起/展开同一 widget）。
 *  与原生 buildCollapsedRanges 同算法；每次事务重建（doc 静态、事务仅来自本机制，成本可忽略） */
function buildUnchangedDeco(state: EditorState, label: (n: number) => string, chipLabel: string): DecorationSet {
    const chunks = getChunks(state)?.chunks
    if (!chunks) return Decoration.none
    const expanded = state.field(expandedUnchanged)
    const spans = chunks.map((c) => ({
        from: state.doc.lineAt(c.fromB).number,
        to: state.doc.lineAt(Math.min(state.doc.length, c.toB)).number,
    }))
    const ranges = computeUnchangedRanges(spans, state.doc.lines)
    const builder = new RangeSetBuilder<Decoration>()
    for (const { fromLine, toLine } of ranges) {
        const startPos = state.doc.line(fromLine).from
        builder.add(
            startPos,
            state.doc.line(toLine).to,
            Decoration.replace({
                widget: new UnchangedRegionWidget(
                    startPos, fromLine, toLine,
                    expanded.includes(startPos), label, chipLabel,
                ),
                block: true,
            }),
        )
    }
    return builder.finish()
}

/** 自研未变更区折叠 extension。必须在 unifiedMergeView 之后挂载——装饰在字段
 *  create 时读取 chunk 字段，依赖 extension 顺序保证 chunk 先初始化（原生同款前提）。
 *  总开关内置（ENABLE_UNCHANGED_COLLAPSE=false 时返回空数组），调用方无需感知 */
export function createUnchangedCollapse(label: (n: number) => string, chipLabel: string) {
    if (!ENABLE_UNCHANGED_COLLAPSE) return []
    return [
        expandedUnchanged,
        StateField.define<DecorationSet>({
            create: (state) => buildUnchangedDeco(state, label, chipLabel),
            update: (_deco, tr) => buildUnchangedDeco(tr.state, label, chipLabel),
            provide: (f) => EditorView.decorations.from(f),
        }),
    ]
}
