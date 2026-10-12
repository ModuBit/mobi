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

/**
 * Link input rule：输入 `[text](url)` 完成后（打完 `)`）→
 * 删除字面语法 + 插入 text（带 link mark href=url）。
 *
 * @tiptap/markdown 只在 setContent/粘贴时解析 markdown，不提供打字时 inline 解析。
 * StarterKit 的 Bold/Italic/Strike/Code 自带 input rule（`**b**`/`*i*` 等），Link 无，故自写。
 */
export function linkInputRule(): InputRule {
    return new InputRule({
        find: /\[([^\]]+)\]\(([^)\s]+)\)$/,
        handler: ({ match, range, chain, state }) => {
            // 排除图片语法 ![alt](url)：[ 前一字符若是 !，本规则放行，留给 imageInputRule 处理。
            // 多个 input rule 独立触发（非短路），不加这层守卫 linkInputRule 会抢占图片。
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
