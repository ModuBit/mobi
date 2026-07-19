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
import slashCommand from '@/components/ui/slashCommandPlugin'

/** 用 slash 扩展构造 Marked（gfm + breaks，模拟 user-text 渲染环境） */
function render(text: string): string {
    const marked = new Marked({ gfm: true, breaks: true })
    marked.use({ extensions: [slashCommand()] })
    return marked.parse(text, { async: false }) as string
}

describe('slashCommandPlugin', () => {
    it('段首 /command 渲染为 badge，参数保留', () => {
        const html = render('/compact 总结一下')
        expect(html).toContain('class="slash-command-badge"')
        expect(html).toContain('/compact')
        expect(html).toContain('总结一下')
    })

    it('段落中间的 /command 也渲染为 badge（不限首行首字符，与 sender 对齐）', () => {
        const html = render('你好 /compact 总结')
        expect(html).toContain('class="slash-command-badge"')
        expect(html).toContain('/compact')
        expect(html).toContain('你好')
    })

    it('无参数的 /command 渲染为 badge', () => {
        const html = render('看 /init 这条')
        expect(html).toContain('class="slash-command-badge"')
        expect(html).toContain('/init')
    })

    it('/command 参数中的 markdown 仍生效', () => {
        const html = render('/compact **粗体**')
        expect(html).toContain('class="slash-command-badge"')
        expect(html).toContain('<strong>粗体</strong>')
    })

    it('不误伤路径 /path/to/x（命令名后紧跟 / 不识别）', () => {
        const html = render('看 /path/to/x 结束')
        expect(html).not.toContain('class="slash-command-badge"')
        expect(html).toContain('/path/to/x')
    })

    it('不误伤 /foo(bar)（命令名后紧跟 ( 不识别）', () => {
        const html = render('看 /foo(bar) 结束')
        expect(html).not.toContain('class="slash-command-badge"')
    })

    it('a/b/c 不识别（/ 前非空白，非独立词）', () => {
        const html = render('路径 a/b/c 结束')
        expect(html).not.toContain('class="slash-command-badge"')
    })

    it('命令名仅允许 [a-zA-Z0-9_-]', () => {
        const html = render('/board-2 详情')
        expect(html).toContain('class="slash-command-badge"')
        expect(html).toContain('/board-2')
    })
})
