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
 * 单文件 diff 渲染（票05/票01 spike 结论 go）：@codemirror/merge readonly unified——
 * before 全文作 original，after 全文作 doc，天然虚拟化（.cm-line 恒定）+ collapseUnchanged
 * 折叠大段未变更区。主题走 --ant-* CSS 变量零 reconfigure（light/dark 切换自动跟随）。
 * patch 字段仅统计/降级用，本组件不渲染 patch。
 */

import { useEffect, useRef } from 'react'
import { EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, ViewUpdate, lineNumbers, WidgetType, type DecorationSet } from '@codemirror/view'
import { getChunks, unifiedMergeView } from '@codemirror/merge'
import { useTranslation } from 'react-i18next'

/** antd token → codemirror 颜色桥接（双主题各自有值，direction 由 antd 保证） */
const diffTheme = EditorView.theme({
    // 全宽全高：merge baseTheme 对 unified 视图强制「height auto + 不滚动」（随内容
    // 撑开、靠外层滚），审查面板需要的是 editor 自身占满面板并内部滚动——须带
    // .cm-mergeView 前缀 + !important 压回（真机实证 2026-09-27：无前缀被压成 643px）
    '&': {
        color: 'var(--ant-color-text)',
        backgroundColor: 'transparent',
        // 字号/行高对齐 beautiful-ui diff 的透气密度（12.5 × 1.65）
        fontSize: '12.5px',
        width: '100% !important',
        height: '100% !important',
        overflowY: 'auto !important',
    },
    '.cm-scroller': { height: '100% !important', overflowY: 'auto !important' },
    '.cm-content': { fontFamily: 'var(--font-mono, monospace)', padding: '12px 0', lineHeight: '1.65' },
    '.cm-gutters': {
        backgroundColor: 'var(--ant-color-fill-quaternary)',
        color: 'var(--ant-color-text-tertiary)',
        border: 'none',
        // 行号列与正文的发丝分隔（参考 beautiful-ui diff 的 gutter hairline）
        borderRight: '1px solid var(--ant-color-border-secondary)',
    },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    // 变更行（增/改）与被删块：行级浅底 + 行首 accent 竖条 + 词级圆角淡染三层。
    // ⚠️ merge 包 baseTheme 的行/词级规则带 `&.cm-merge-b` 特异性（真机实证
    // 2026-09-27：无前缀规则被压成透明/渐变下划线），& 即 editor 根元素（scope 类
    // 挂在它身上，写成 '.cm-merge-b …' 会变成后代选择器永不匹配），连写两级类压回
    // 新增/修改行：柔和绿底（accent 竖条在 gutter 行号左侧，见行号 cell 规则）
    '&.cm-editor.cm-merge-b .cm-changedLine': {
        backgroundColor: 'color-mix(in srgb, var(--ant-color-success) 10%, transparent)',
    },
    // merge 自带的行级 gutter 标记（行号 cell 右缘、贴发丝线一侧）是唯一的 accent 竖条：
    // 加宽到 4px；删除行改红色斜纹（55% 柔化，与词级淡染同色系），新增行保持实心绿
    '&.cm-editor.cm-merge-b .cm-deletedLineGutter': {
        width: '4px',
        background: 'repeating-linear-gradient(45deg, color-mix(in srgb, var(--ant-color-error) 100%, transparent) 0, color-mix(in srgb, var(--ant-color-error) 100%, transparent) 1.5px, transparent 1.5px, transparent 3.5px)',
    },
    '&.cm-editor.cm-merge-b .cm-insertedLineGutter': { width: '4px' },
    // unified 视图里增行的标记实际挂 changedLineGutter（insertedLineGutter 不渲染，实证 2026-09-28）
    '&.cm-editor.cm-merge-b .cm-changedLineGutter': { width: '4px' },
    // 被删块：柔和红底（accent 斜纹竖条见 deletedLineGutter）
    '.cm-deletedChunk': {
        backgroundColor: 'color-mix(in srgb, var(--ant-color-error) 10%, transparent)',
        position: 'relative',
    },
    // 词级高亮：18% 语义色圆角淡染（color-mix 走 token 语义色，双主题自动跟随）
    '&.cm-editor.cm-merge-b .cm-changedText': {
        background: 'color-mix(in srgb, var(--ant-color-success) 18%, transparent)',
        borderRadius: '3px',
    },
    '&.cm-editor.cm-merge-b .cm-deletedText': {
        background: 'color-mix(in srgb, var(--ant-color-error) 18%, transparent)',
        borderRadius: '3px',
    },
    // 双栏行号（GitHub unified 语义）：行号列定宽对齐；行号小一号常规字重（参考
    // beautiful-ui 的 11px 轻行号），新增行号绿、被删行号红
    '.cm-lineNumbers .cm-gutterElement': { minWidth: '40px', boxSizing: 'border-box', fontSize: '11px' },
    // 变更行的行号 cell：行号绿字（accent 竖条用 merge 自带的 insertedLineGutter，见上）
    '.cm-lineNumbers .cm-gutterElement.cm-line-no-insert': {
        color: 'var(--ant-color-success)', fontWeight: 500,
    },
    // 被删行文本与正文行同刻度：chunk 自带 6px 左 padding（与 .cm-line 的 6px 对应），
    // 行内补右 2px 使换行宽度一致
    '.cm-deletedChunk .cm-deletedLine': { position: 'relative', padding: '0 2px 0 0' },
    // 被删行号负偏移到 gutter 列：度量复刻真实行号 cell（minWidth 40 + padding 5/3），
    // 右缘锚到行盒左缘再退 9px（6px chunk pad + 3px 列距）→ 与正常行号同一坐标；
    // gutter sticky z-index 200 须压过
    '.cm-deleted-line-no': {
        position: 'absolute', right: 'calc(100% + 9px)', minWidth: '40px', boxSizing: 'border-box',
        padding: '0 3px 0 5px', textAlign: 'right', fontSize: '11px',
        color: 'var(--ant-color-error)', fontWeight: 500, zIndex: 201,
    },
})

/** 偏移 → before 文档第几行（1-based；行号语义 = GitHub unified 的旧文件列） */
function beforeLineOf(before: string, offset: number): number {
    let line = 1
    for (let i = 0; i < offset && i < before.length; i++) {
        if (before[i] === '\n') line += 1
    }
    return line
}

// ---------- 未变更区折叠（自研替换原生 collapseUnchanged） ----------
// 原生 CollapseWidget 点击展开是单向的（CollapsedRanges 只删不增），无法折回。
// 自研同款算法（margin 3 / minSize 5 与原配置一致）+ 可逆状态：expandedUnchanged
// 存已展开区的起点集合，doc 只读不变、位置恒定。展开/收起全程由同一个块 widget
// 承载（head 折叠条/芯片 + 行内容自渲染），以 grid-template-rows auto 0fr↔auto 1fr
// 成对过渡（DESIGN.md Motion：双向缓动、可打断、时长曲线走 antd token、
// prefers-reduced-motion 降级瞬时），样式见 antd.css「未变更区折叠」段。

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
    const builder = new RangeSetBuilder<Decoration>()
    let prevLine = 1
    for (let i = 0; ; i++) {
        const chunk = i < chunks.length ? chunks[i] : null
        const collapseFrom = i ? prevLine + UNCHANGED_MARGIN : 1
        const collapseTo = chunk ? state.doc.lineAt(chunk.fromB).number - 1 - UNCHANGED_MARGIN : state.doc.lines
        const lines = collapseTo - collapseFrom + 1
        if (lines >= UNCHANGED_MIN_SIZE) {
            const startPos = state.doc.line(collapseFrom).from
            builder.add(
                startPos,
                state.doc.line(collapseTo).to,
                Decoration.replace({
                    widget: new UnchangedRegionWidget(
                        startPos, collapseFrom, collapseTo,
                        expanded.includes(startPos), label, chipLabel,
                    ),
                    block: true,
                }),
            )
        }
        if (!chunk) break
        prevLine = state.doc.lineAt(Math.min(state.doc.length, chunk.toB)).number
    }
    return builder.finish()
}

/** 自研未变更区折叠 extension。必须在 unifiedMergeView 之后挂载——装饰在字段
 *  create 时读取 chunk 字段，依赖 extension 顺序保证 chunk 先初始化（原生同款前提） */
function createUnchangedCollapse(label: (n: number) => string, chipLabel: string) {
    return [
        expandedUnchanged,
        StateField.define<DecorationSet>({
            create: (state) => buildUnchangedDeco(state, label, chipLabel),
            update: (_deco, tr) => buildUnchangedDeco(tr.state, label, chipLabel),
            provide: (f) => EditorView.decorations.from(f),
        }),
    ]
}

/**
 * 双栏行号补齐插件：merge view 的被删行是块 widget（不在 doc 里），内置行号 gutter
 * 不覆盖；本插件按 getChunks 算出被删行的候选旧行号，按文本与 DOM 行贪心配对后注入
 * （chunk 内 context 行不会出现在 DOM，行序与候选序可能稀疏错位）。同时给「新增 doc 行」
 * 的行号单元挂绿标。视图虚拟化 → 只处理当前渲染的 DOM 行，viewport 变化时重算。
 */
function createChunkLineNumbers(before: string) {
    return ViewPlugin.fromClass(
        class {
            private mo: MutationObserver | undefined
            private scheduled = false

            constructor(private readonly view: EditorView) {
                // 只读视图可能永远没有事务（readOnly + 外层容器滚动，CM 感知不到 viewport
                // 变化），update() 可能一次都不触发（实证 2026-09-28：后展开的文件行号
                // 永不注入）——注入以 DOM 为准：观察块 widget 挂载/卸载，rAF 去抖后同步
                this.mo = new MutationObserver(() => {
                    if (this.scheduled) return
                    this.scheduled = true
                    requestAnimationFrame(() => {
                        this.scheduled = false
                        this.sync()
                    })
                })
                this.mo.observe(view.dom, { childList: true, subtree: true })
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged || update.geometryChanged) this.sync()
            }

            destroy() {
                this.mo?.disconnect()
            }

            private sync() {
                const view = this.view
                // merge view 异步初始化（spec：未完成时返回 null）；未就绪时本次 DOM 变更
                // 已在观察队列里，就绪后的挂载会再次触发
                const chunks = getChunks(view.state)?.chunks
                if (!chunks) return

                // 0) gutter 实宽写入 CSS 变量：删除块 ::before 的竖条要负偏移到 gutter 最左缘
                const gutterEl = view.dom.querySelector<HTMLElement>('.cm-gutters')
                if (gutterEl) view.dom.style.setProperty('--cm-diff-gutter-w', `${Math.ceil(gutterEl.getBoundingClientRect().width)}px`)

                // 1) 被删行号注入：.cm-deletedChunk 与 chunk 一一对应（merge 源码
                //  buildDeletedChunks：每 chunk 一个块 widget 挂在 chunk.fromB，posAtDOM
                //  可精确解析回同一位置）；被删行内容 = chunk 的整个 A 侧跨度
                //  （sliceString(fromA, endA)，与 changes 里有无删除记录无关——字符级 diff
                //  下被删行可能只表现为纯插入，2026-09-28 tsconfig 实证），行号按该跨度的
                //  行界计算，块内第 i 个 .cm-deletedLine 即第 i 行。视口外 chunk 无 DOM 块，
                //  自然跳过。
                const chunkEls = [...view.dom.querySelectorAll<HTMLDivElement>('.cm-deletedChunk')]
                for (const el of chunkEls) {
                    const pos = view.posAtDOM(el, 0)
                    const chunk = chunks.find((c) => c.fromB === pos)
                    if (!chunk || chunk.fromA >= chunk.toA) continue
                    const first = beforeLineOf(before, chunk.fromA)
                    const lineEls = el.querySelectorAll<HTMLDivElement>('.cm-deletedLine')
                    lineEls.forEach((line, i) => {
                        if (line.querySelector('.cm-deleted-line-no')) return
                        const span = document.createElement('span')
                        span.className = 'cm-deleted-line-no'
                        span.textContent = String(first + i)
                        line.prepend(span)
                    })
                }

                // 2) 新增 doc 行的行号单元挂绿标：gutter 单元里有测量占位（非数字），且与
                // 内容行不在同一容器——按渲染序 + 行首 y 坐标配对
                const cells = [...view.dom.querySelectorAll<HTMLDivElement>('.cm-lineNumbers .cm-gutterElement')]
                    .filter((c) => /^\d+$/.test(c.textContent ?? ''))
                const lines = [...view.dom.querySelectorAll<HTMLDivElement>('.cm-content > .cm-line')]
                const tops = new Map<number, HTMLDivElement>()
                for (const line of lines) {
                    const top = Math.round(line.getBoundingClientRect().top)
                    tops.set(top, line)
                }
                for (const cell of cells) {
                    const line = tops.get(Math.round(cell.getBoundingClientRect().top))
                    if (!line) continue
                    cell.classList.toggle('cm-line-no-insert', line.classList.contains('cm-changedLine'))
                }
            }
        },
    )
}

export function DiffViewer({ before, after }: { before: string; after: string }) {
    const { t } = useTranslation()
    const hostRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        const host = hostRef.current
        if (!host) return

        const view = new EditorView({
            state: EditorState.create({
                doc: after,
                extensions: [
                    diffTheme,
                    EditorView.lineWrapping,
                    // 行号 = 新文件（doc=after）行号；被删块是行间 widget，行号由
                    // createChunkLineNumbers 注入（旧行号，红标）
                    lineNumbers(),
                    createChunkLineNumbers(before),
                    // 只读双 extension：state 层禁止事务 + view 层不可编辑（spike 结论）
                    EditorState.readOnly.of(true),
                    EditorView.editable.of(false),
                    unifiedMergeView({
                        original: before,
                        highlightChanges: true,
                        mergeControls: false,
                        // 折叠由 createUnchangedCollapse 承担（原生单向展开无法折回）；
                        // 现阶段整体禁用——见 ENABLE_UNCHANGED_COLLAPSE
                    }),
                    // 须在 unifiedMergeView 之后：create 时读取 chunk 字段（依赖初始化顺序）
                    ...(ENABLE_UNCHANGED_COLLAPSE
                        ? createUnchangedCollapse(
                            (n) => t('review.unchangedLines', { n }),
                            t('review.collapseUnchanged'),
                        )
                        : []),
                ],
            }),
            parent: host,
        })
        return () => {
            delete (window as unknown as Record<string, unknown>).__dbgUnchanged
            view.destroy()
        }
    }, [before, after])

    return (
        <div
            data-testid="git-diff-viewer"
            aria-label={t('review.diffAria')}
            style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'auto', minHeight: 0 }}
            ref={hostRef}
        />
    )
}
