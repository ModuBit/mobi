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

import { InputRule } from '@tiptap/core'
import Link from '@tiptap/extension-link'

/**
 * 链接输入规则：`[text](url)` 打完 `)` 即转链接
 * （@tiptap/markdown 只在 setContent/粘贴时解析，不提供逐键 inline 解析）。
 *
 * 排除图片语法 ![alt](url)：多个 input rule 独立触发（非短路），
 * 不加这层守卫 linkInputRule 会抢占图片。文件编辑器（MarkdownEditorView）与
 * composer 共用这一实现——两边都是「markdown 打字即格式化」的同一语义。
 */
function linkInputRule(): InputRule {
    return new InputRule({
        find: /\[([^\]]+)\]\(([^)\s]+)\)$/,
        handler: ({ match, range, chain, state }) => {
            const before = range.from > 0 ? state.doc.textBetween(range.from - 1, range.from) : ''
            if (before === '!') return
            const text = match[1]
            const url = match[2]
            // 插入 link text + 一个空格（不带 mark），光标定位到空格后。
            // 空格隔断 mark 继承：否则光标停在 link mark 内，后续打字全被纳入 link。
            chain()
                .deleteRange({ from: range.from, to: range.to })
                .insertContentAt(range.from, [
                    { type: 'text', text, marks: [{ type: 'link', attrs: { href: url } }] },
                    { type: 'text', text: ' ' },
                ])
                .setTextSelection(range.from + text.length + 1)
                .run()
        },
    })
}

/** Link 扩展 + 打字输入规则（两处富文本编辑器的统一装配件） */
export const LinkWithInputRule = Link.extend({
    addInputRules() {
        return [linkInputRule()]
    },
})
