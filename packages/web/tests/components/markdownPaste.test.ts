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

import { describe, it, expect } from 'vitest'
import { looksLikeMarkdownBlock } from '@/ui/base/interactive/chat-input/markdownPaste'

describe('looksLikeMarkdownBlock（粘贴 Markdown 块级判定）', () => {
    it.each([
        ['# 标题', '一级标题'],
        ['### 三级标题', '三级标题'],
        ['- 列表项', '无序列表（-）'],
        ['* 列表项', '无序列表（*）'],
        ['+ 列表项', '无序列表（+）'],
        ['1. 列表项', '有序列表'],
        ['> 引用', '引用块'],
        ['```js', '围栏代码块（反引号）'],
        ['~~~', '围栏代码块（波浪号）'],
        ['| a | b |', 'GFM 表格行'],
        ['   ## 缩进标题', '最多三空格缩进'],
    ])('%s → true（%s）', (text) => {
        expect(looksLikeMarkdownBlock(text)).toBe(true)
    })

    it('弱标记只看首个非空行：后续行的列表/标题不触发整段富文本化', () => {
        expect(looksLikeMarkdownBlock('普通一行\n- 列表项')).toBe(false)
        expect(looksLikeMarkdownBlock('def parse():\n    return 1\n# TODO: 边界\nx = 2')).toBe(false)
        expect(looksLikeMarkdownBlock('diff --git a/x b/x\n+ added\n- removed')).toBe(false)
    })

    it('强标记（围栏/表格）出现在任意行都触发', () => {
        expect(looksLikeMarkdownBlock('普通一行\n```js\nconst a = 1\n```')).toBe(true)
        expect(looksLikeMarkdownBlock('普通一行\n| a | b |')).toBe(true)
    })

    it.each([
        ['**加粗**', '纯行内标记'],
        ['*斜体* 和 `代码`', '行内标记混排'],
        ['const a = 2 ** 3', '幂运算不被当成列表/加粗'],
        ['// 注释 * 星号', '行中星号不是列表'],
        ['a | b', '无首尾竖线的管道符不是表格'],
        ['#### 四级标题', '超出 composer h1–h3 能力'],
        ['####### 七个井号', '超过六级标题'],
        ['#没有空格', '井号后没有空格'],
        ['-没有空格', '连字符后没有空格'],
        ['', '空文本'],
    ])('%s → false（%s）', (text) => {
        expect(looksLikeMarkdownBlock(text)).toBe(false)
    })
})
