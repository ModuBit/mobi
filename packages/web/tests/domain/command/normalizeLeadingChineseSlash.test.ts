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
import { normalizeLeadingChineseSlash } from '@/domain/command/slashCommandHelper'

describe('normalizeLeadingChineseSlash', () => {
    it('空输入后手输顿号：归一为 /', () => {
        expect(normalizeLeadingChineseSlash('、', '')).toBe('/')
    })

    it('已有正文时在行首手输顿号：同样归一（保留原正文）', () => {
        expect(normalizeLeadingChineseSlash('、help', 'help')).toBe('/help')
    })

    it('正文中间的顿号不归一（只处理行首）', () => {
        expect(normalizeLeadingChineseSlash('a、b', 'ab')).toBeNull()
    })

    it('非顿号首字符不动', () => {
        expect(normalizeLeadingChineseSlash('/help', '')).toBeNull()
        expect(normalizeLeadingChineseSlash('你好', '')).toBeNull()
    })

    it('粘贴多字符（以顿号开头的整段文本）不归一', () => {
        expect(normalizeLeadingChineseSlash('、这是一段粘贴的正文', '')).toBeNull()
    })

    it('前值本就以顿号开头时不重复归一（连续输入正文）', () => {
        expect(normalizeLeadingChineseSlash('、h', '、')).toBeNull()
    })

    it('删除字符（长度未增）不归一', () => {
        expect(normalizeLeadingChineseSlash('、', '、h')).toBeNull()
    })
})
