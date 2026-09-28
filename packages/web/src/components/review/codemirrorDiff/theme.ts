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

import { EditorView } from '@codemirror/view'

/** antd token → codemirror 颜色桥接（双主题各自有值，direction 由 antd 保证） */
export const diffTheme = EditorView.theme({
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
