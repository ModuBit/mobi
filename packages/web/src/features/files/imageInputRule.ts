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
 * Image input rule：输入 `![alt](url)` 完成后（打完 `)`）→
 * 删除字面语法 + 插入 image 节点。
 *
 * 与 linkInputRule 同理：@tiptap/markdown 只在 setContent/粘贴时解析 markdown，
 * 不提供打字时 inline 解析，故自写。
 * 不支持 `![alt](url "title")` 带 title 的形式（简化，保持正则可读）。
 */
export function imageInputRule(): InputRule {
    return new InputRule({
        find: /!\[([^\]]*)\]\(([^)\s]+)\)$/,
        handler: ({ match, range, chain }) => {
            const alt = match[1]
            const src = match[2]
            // insertContentAt 默认 updateSelection=true，插入后光标移到 image 之后
            chain()
                .deleteRange({ from: range.from, to: range.to })
                .insertContentAt(range.from, { type: 'image', attrs: { src, alt } })
                .run()
        },
    })
}
