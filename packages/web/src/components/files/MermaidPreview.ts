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

import { Extension } from '@tiptap/core'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { buildMermaidWidget } from './mermaidWidget'

/**
 * 带「折叠」属性的 codeBlock：默认折叠（仅 mermaid 块用此属性，见 MermaidPreview 装饰；
 * 非 mermaid 块虽有此属性但装饰不读它，故不受影响）。collapsed 不参与 markdown 序列化
 * （@tiptap/markdown 只输出 ```lang 围栏），不污染 .md。
 */
export const MermaidCodeBlock = CodeBlockLowlight.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            collapsed: { default: true },
        }
    },
})

/**
 * mermaid 预览 decoration：在原生 codeBlock（language=mermaid）之前插入渲染图 widget，
 * 并按 collapsed 属性给 codeBlock 加折叠 class。
 *
 * 为什么用 decoration 而非 NodeView：自定义 NodeView 给 codeBlock 提供 contentDOM 会破坏
 * ProseMirror 的 code 输入处理（contenteditable contentDOM 里浏览器把 ProseMirror 写入的 \n
 * 转成 <br>，被 MutationObserver 当外部突变 → handleDOMChange 误判回车 → 插 \n → 重渲染 →
 * 再被当突变 → 无限循环，mermaid 块进源码态即卡死）。调用栈已证实。
 *
 * decoration 方案保留原生 codeBlock（ProseMirror 自管，不卡），widget 是 contenteditable=false
 * 的装饰节点，其内部 DOM 突变被忽略，不触发 handleDOMChange。折叠/展开/缩放都在 widget 与
 * codeBlock 外观层操作，不碰那条致命路径。
 */
export const MermaidPreview = Extension.create({
    name: 'mermaidPreview',
    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('mermaidPreview'),
                props: {
                    decorations(state) {
                        const decos: Decoration[] = []
                        state.doc.descendants((node, pos) => {
                            const isMermaid = node.type.name === 'codeBlock'
                                && node.attrs.language === 'mermaid'
                                && node.textContent.trim()
                            if (!isMermaid) return
                            const code = node.textContent
                            const collapsed = node.attrs.collapsed !== false
                            const end = pos + node.nodeSize

                            // 图 widget（含缩放 + 展开按钮），插在 codeBlock 前
                            // key 带 code（改源码时重建 → 图刷新）、不带 collapsed（切换靠命令式翻图标 + decoration.node，不重建 widget）
                            decos.push(
                                Decoration.widget(
                                    pos,
                                    (view, getPos) => buildMermaidWidget(code, collapsed, () => {
                                        const cbPos = getPos()
                                        if (cbPos == null) return
                                        // 读当前 attrs（防 stale 闭包）：切换 collapsed
                                        const node = view.state.doc.nodeAt(cbPos)
                                        const cur = node?.attrs.collapsed !== false
                                        const { state: st } = view
                                        const { from, to } = st.selection
                                        let tr = st.tr.setNodeAttribute(cbPos, 'collapsed', !cur)
                                        // 折叠时光标若在该块内，移到块前（避免光标困在隐藏块里）
                                        if (cur === false && from >= pos && to <= end) {
                                            tr = tr.setSelection(TextSelection.near(st.doc.resolve(pos), -1))
                                        }
                                        view.dispatch(tr)
                                    }),
                                    { side: -1, stopEvent: () => true, key: `mp-${pos}-${code.length}-${code.slice(-12)}` },
                                ),
                            )

                            // 折叠态：给 codeBlock 加隐藏 class
                            if (collapsed) {
                                decos.push(Decoration.node(pos, end, { class: 'mermaid-source-collapsed' }))
                            }
                        })
                        return DecorationSet.create(state.doc, decos)
                    },
                },
            }),
        ]
    },
})
