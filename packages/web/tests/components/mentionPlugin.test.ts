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
import { Marked } from 'marked'
import mention from '@/components/ui/mentionPlugin'

/** 用 mention 扩展构造一个 Marked 实例（gfm 开启删除线，模拟 user-text 渲染环境） */
function render(text: string): string {
    const marked = new Marked({ gfm: true, breaks: true })
    marked.use({ extensions: [mention()] })
    return marked.parse(text, { async: false }) as string
}

describe('mentionPlugin', () => {
    it('把 @~/path 渲染为 badge（保留 @ 前缀），~ 不触发删除线', () => {
        const html = render('balabala @~/a/b/c balabala')
        expect(html).toContain('class="mention-badge"')
        expect(html).toContain('@~/a/b/c')
        // 不含 <del>（删除线）
        expect(html).not.toContain('<del>')
        expect(html).not.toContain('<s>')
    })

    it('badge 是 file/open 动作链接（a href=mobi://file/open，name 由执行器基名兜底）', () => {
        const html = render('看 @src/app/main.ts end')
        expect(html).toContain('href="mobi://file/open?path=src%2Fapp%2Fmain.ts"')
    })

    it('两个 mention 之间的内容不被渲染为删除线', () => {
        const html = render('balabala @~/a/b/c balabals @~/e/f/g balabala')
        const badgeMatches = html.match(/class="mention-badge"/g)
        expect(badgeMatches?.length).toBe(2)
        expect(html).toContain('@~/a/b/c')
        expect(html).toContain('@~/e/f/g')
        expect(html).not.toContain('<del>')
        expect(html).not.toContain('<s>')
    })

    it('mention 含两个 ~ 时仍整体作为 badge（~/x/~/y）', () => {
        const html = render('see @~/x/~/y end')
        expect(html).toContain('class="mention-badge"')
        expect(html).toContain('@~/x/~/y')
        expect(html).not.toContain('<del>')
    })

    it('消息开头的 mention 也识别', () => {
        const html = render('@/a/b/c 后续文本')
        expect(html).toContain('class="mention-badge"')
        expect(html).toContain('@/a/b/c')
    })

    it('相对路径 @../../x/b/ 识别为 badge', () => {
        const html = render('see @../../x/b/ end')
        expect(html).toContain('class="mention-badge"')
        expect(html).toContain('@../../x/b/')
        expect(html).not.toContain('<del>')
    })

    it('相对路径 @./a/b/c 识别为 badge', () => {
        const html = render('see @./a/b/c end')
        expect(html).toContain('class="mention-badge"')
        expect(html).toContain('@./a/b/c')
    })

    it('点开头的路径 @.abc/a/b/c 识别为 badge', () => {
        const html = render('see @.abc/a/b/c end')
        expect(html).toContain('class="mention-badge"')
        expect(html).toContain('@.abc/a/b/c')
    })

    it('中文路径整体识别为 badge（Unicode 字母不截断）', () => {
        const html = render('@~/Documents/代位追偿/张磊-行驶证.pdf 这个你能解析出来么')
        expect(html).toContain('class="mention-badge"')
        expect(html).toContain('@~/Documents/代位追偿/张磊-行驶证.pdf')
        // URI 里路径整体编码（含中文段），不在中文处断开
        expect(html).toContain('path=%7E%2FDocuments%2F%E4%BB%A3%E4%BD%8D%E8%BF%BD%E5%81%BF%2F%E5%BC%A0%E7%A3%8A-%E8%A1%8C%E9%A9%B6%E8%AF%81.pdf')
    })

    it('emoji / 括号 / # / + 等符号路径整体识别（排除法放行）', () => {
        const html = render('看 @~/备份(1)/📸图#2+c++.pdf 谢谢')
        expect(html).toContain('class="mention-badge"')
        expect(html).toContain('@~/备份(1)/📸图#2+c++.pdf')
    })

    it('空白终止 mention：空格后的内容不进 badge（路径不支持空格）', () => {
        const html = render('@~/My Docs/a.pdf end')
        expect(html).toContain('@~/My')
        expect(html).not.toContain('@~/My Docs')
    })

    it('结构排除字符（` < > " \\）截断 mention', () => {
        const html = render('@~/a"b/c end')
        expect(html).toContain('@~/a')
        expect(html).not.toContain('@~/a"b')
    })

    it('不误伤 email（a@b.com 不识别为 mention，@ 也不破坏 email）', () => {
        const html = render('联系 a@b.com 联系')
        expect(html).not.toContain('class="mention-badge"')
        // email 文本保留
        expect(html).toContain('a@b.com')
    })

    it('不带分隔符的 @file 不识别为 mention（避免吞普通 @ 提及）', () => {
        const html = render('hi @john 看')
        expect(html).not.toContain('class="mention-badge"')
        expect(html).toContain('@john')
    })

    it('路径中的 @ 截断 token：不贪婪吞掉后续 @（@ 是触发符）', () => {
        // 回归：@ 在排除集外时 @src/a@docs/b 被并成一个指向不存在路径的 mention
        const html = render('看 @src/a@docs/b 谢谢')
        expect(html).toContain('@src/a')
        expect(html).not.toContain('src/a@docs/b')
    })

    it('删除线语法在无 mention 干涉时仍正常生效', () => {
        const html = render('普通 ~删除线~ 文本')
        expect(html).toContain('<del>')
    })
})
