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

    it('删除线语法在无 mention 干涉时仍正常生效', () => {
        const html = render('普通 ~删除线~ 文本')
        expect(html).toContain('<del>')
    })
})
