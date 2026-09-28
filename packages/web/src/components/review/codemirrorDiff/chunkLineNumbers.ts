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
 * 双栏行号补齐：merge view 的被删行是块 widget（不在 doc 里），内置行号 gutter
 * 不覆盖。行号候选由 chunk 的 A 侧跨度推导（纯函数 oldLineNumbers——字符级 diff 下
 * 被删行可能只表现为纯插入，行号不能取自 changes 记录），按文本与 DOM 行贪心配对后
 * 注入（chunk 内 context 行不出现在 DOM，行序与候选序可能稀疏错位）。同时给「新增
 * doc 行」的行号单元挂绿标。视图虚拟化 → 只处理当前渲染的 DOM 行。
 *
 * 注入以 DOM 为准（MutationObserver + rAF 去抖）：只读视图 + 外层容器滚动下 CM
 * 感知不到 viewport 变化，update() 可能一次都不触发（实证 2026-09-28）。
 */

import type { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, ViewUpdate, lineNumbers } from '@codemirror/view'
import { getChunks } from '@codemirror/merge'

/** 偏移 → before 文档第几行（1-based；行号语义 = GitHub unified 的旧文件列） */
export function beforeLineOf(before: string, offset: number): number {
    let line = 1
    for (let i = 0; i < offset && i < before.length; i++) {
        if (before[i] === '\n') line += 1
    }
    return line
}

/**
 * 纯函数：chunk A 侧跨度 [fromA, toA) 覆盖的旧文件行号列表（升序）。
 * 跨度为空（fromA ≥ toA，纯插入 chunk）返回 []，由调用方跳过。
 */
export function oldLineNumbers(before: string, fromA: number, toA: number): number[] {
    if (fromA >= toA) return []
    const first = beforeLineOf(before, fromA)
    const last = beforeLineOf(before, toA - 1)
    const out: number[] = []
    for (let n = first; n <= last; n++) out.push(n)
    return out
}

/** 双栏行号补齐插件工厂。必须在 unifiedMergeView 之后挂载（读 chunk 字段） */
export function createChunkLineNumbers(before: string): Extension {
    return ViewPlugin.fromClass(
        class {
            private mo: MutationObserver | undefined
            private scheduled = false

            constructor(private readonly view: EditorView) {
                // 只读视图可能永远没有事务（readOnly + 外层容器滚动，CM 感知不到 viewport
                // 变化），update() 可能一次都不触发——注入以 DOM 为准：观察块 widget
                // 挂载/卸载，rAF 去抖后同步
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
                //  可精确解析回同一位置）；行号候选取 chunk 的整个 A 侧跨度
                //  （sliceString(fromA, endA)，与 changes 里有无删除记录无关——字符级 diff
                //  下被删行可能只表现为纯插入，2026-09-28 tsconfig 实证），块内第 i 个
                //  .cm-deletedLine 对应候选第 i 个（超出取末尾行号兜底）。视口外 chunk
                //  无 DOM 块，自然跳过。
                const chunkEls = [...view.dom.querySelectorAll<HTMLDivElement>('.cm-deletedChunk')]
                for (const el of chunkEls) {
                    const pos = view.posAtDOM(el, 0)
                    const chunk = chunks.find((c) => c.fromB === pos)
                    if (!chunk) continue
                    const nums = oldLineNumbers(before, chunk.fromA, chunk.toA)
                    if (nums.length === 0) continue
                    const lineEls = el.querySelectorAll<HTMLDivElement>('.cm-deletedLine')
                    lineEls.forEach((line, i) => {
                        if (line.querySelector('.cm-deleted-line-no')) return
                        const span = document.createElement('span')
                        span.className = 'cm-deleted-line-no'
                        span.textContent = String(nums[i] ?? nums[nums.length - 1])
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

// lineNumbers 在此 re-export：DiffViewer 的行号语义（新文件行号 + 本插件补旧行号）
// 与补齐插件是一体的，调用方只 import 本模块即可
export { lineNumbers }
