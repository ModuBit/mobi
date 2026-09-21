/*
 * Copyright Manerfan
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

/**
 * Streamdown 用户消息 badge 契约测试（真实渲染管线，不 mock streamdown）
 *
 * 平移旧栈 mentionPlugin（16 断言）与 slashCommandPlugin（8 断言）契约：
 * 识别逻辑同源（streamdownUserSyntax 复用旧正则/判定），输出经 Streamdown
 * allowedTags + literalTagContent + components 渲染。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { StreamdownView } from '@/components/ui/StreamdownView'

// ActionLink 内部用 react-router hooks（测试无 router context），mock 成同构 <a>
// （契约断言的是 href/class，与真实组件一致）
vi.mock('@/components/ui/ActionLink', () => ({
    ActionLink: ({ uri, className, children }: { uri: string; className?: string; children?: React.ReactNode }) => (
        <a href={uri} className={className}>{children}</a>
    ),
}))

/** 用户消息渲染环境（TextBlock 路径：slash + mention 双开） */
function renderMsg(text: string): string {
    const { container } = render(<StreamdownView content={text} enableSlashCommand enableMention />)
    return container.innerHTML
}

describe('mention badge（契约平移）', () => {
    afterEach(cleanup)

    it('把 @~/path 渲染为 badge（保留 @ 前缀），~ 不触发删除线', () => {
        const html = renderMsg('balabala @~/a/b/c balabala')
        expect(html).toContain('class="mention-badge"')
        expect(html).toContain('@~/a/b/c')
        expect(html).not.toContain('<del>')
    })

    it('badge 是 file/open 动作链接', () => {
        const html = renderMsg('看 @src/app/main.ts end')
        expect(html).toContain('href="mobi://file/open?path=src%2Fapp%2Fmain.ts"')
    })

    it('两个 mention 之间的内容不被渲染为删除线', () => {
        const html = renderMsg('balabala @~/a/b/c balabals @~/e/f/g balabala')
        expect(html.match(/class="mention-badge"/g)?.length).toBe(2)
        expect(html).toContain('@~/a/b/c')
        expect(html).toContain('@~/e/f/g')
        expect(html).not.toContain('<del>')
    })

    it('mention 含两个 ~ 时仍整体作为 badge（~/x/~/y）', () => {
        const html = renderMsg('see @~/x/~/y end')
        expect(html).toContain('class="mention-badge"')
        expect(html).toContain('@~/x/~/y')
        expect(html).not.toContain('<del>')
    })

    it('消息开头的 mention 也识别', () => {
        const html = renderMsg('@/a/b/c 后续文本')
        expect(html).toContain('class="mention-badge"')
        expect(html).toContain('@/a/b/c')
    })

    it('相对路径 @../../x/b/ 识别为 badge', () => {
        const html = renderMsg('see @../../x/b/ end')
        expect(html).toContain('class="mention-badge"')
        expect(html).toContain('@../../x/b/')
        expect(html).not.toContain('<del>')
    })

    it('相对路径 @./a/b/c 识别为 badge', () => {
        const html = renderMsg('see @./a/b/c end')
        expect(html).toContain('class="mention-badge"')
        expect(html).toContain('@./a/b/c')
    })

    it('点开头的路径 @.abc/a/b/c 识别为 badge', () => {
        const html = renderMsg('see @.abc/a/b/c end')
        expect(html).toContain('class="mention-badge"')
        expect(html).toContain('@.abc/a/b/c')
    })

    it('中文路径整体识别为 badge（Unicode 字母不截断，URI 整体编码）', () => {
        const html = renderMsg('@~/Documents/代位追偿/张磊-行驶证.pdf 这个你能解析出来么')
        expect(html).toContain('class="mention-badge"')
        expect(html).toContain('@~/Documents/代位追偿/张磊-行驶证.pdf')
        expect(html).toContain('path=%7E%2FDocuments%2F%E4%BB%A3%E4%BD%8D%E8%BF%BD%E5%81%BF%2F%E5%BC%A0%E7%A3%8A-%E8%A1%8C%E9%A9%B6%E8%AF%81.pdf')
    })

    it('emoji / 括号 / # / + 等符号路径整体识别（排除法放行）', () => {
        const html = renderMsg('看 @~/备份(1)/📸图#2+c++.pdf 谢谢')
        expect(html).toContain('class="mention-badge"')
        expect(html).toContain('@~/备份(1)/📸图#2+c++.pdf')
    })

    it('空白终止 mention：空格后的内容不进 badge', () => {
        const html = renderMsg('@~/My Docs/a.pdf end')
        expect(html).toContain('@~/My')
        expect(html).not.toContain('@~/My Docs')
    })

    it('结构排除字符（"）截断 mention', () => {
        const html = renderMsg('@~/a"b/c end')
        expect(html).toContain('@~/a</')
        expect(html).not.toContain('@~/a"b')
    })

    it('不误伤 email（a@b.com 不识别为 mention）', () => {
        const html = renderMsg('联系 a@b.com 联系')
        expect(html).not.toContain('class="mention-badge"')
        expect(html).toContain('a@b.com')
    })

    it('不带分隔符的 @file 不识别为 mention', () => {
        const html = renderMsg('hi @john 看')
        expect(html).not.toContain('class="mention-badge"')
        expect(html).toContain('@john')
    })

    it('路径中的 @ 截断 token：不贪婪吞掉后续 @', () => {
        const html = renderMsg('看 @src/a@docs/b 谢谢')
        expect(html).toContain('@src/a')
        expect(html).not.toContain('src/a@docs/b')
    })

    it('删除线语法在无 mention 干涉时仍正常生效', () => {
        const html = renderMsg('普通 ~删除线~ 文本')
        expect(html).toContain('<del>')
    })
})

describe('slash command badge（契约平移）', () => {
    afterEach(cleanup)

    it('段首 /command 渲染为 badge，参数保留', () => {
        const html = renderMsg('/compact 总结一下')
        expect(html).toContain('class="slash-command-badge"')
        expect(html).toContain('/compact')
        expect(html).toContain('总结一下')
    })

    it('段落中间的 /command 也渲染为 badge', () => {
        const html = renderMsg('你好 /compact 总结')
        expect(html).toContain('class="slash-command-badge"')
        expect(html).toContain('/compact')
        expect(html).toContain('你好')
    })

    it('无参数的 /command 渲染为 badge', () => {
        const html = renderMsg('看 /init 这条')
        expect(html).toContain('class="slash-command-badge"')
        expect(html).toContain('/init')
    })

    it('/command 参数中的 markdown 仍生效', () => {
        const html = renderMsg('/compact **粗体**')
        expect(html).toContain('class="slash-command-badge"')
        // 新栈 strong 渲染为 span[data-streamdown=strong]（见 ticket 02 映射）
        expect(html).toContain('data-streamdown="strong">粗体</span>')
    })

    it('不误伤路径 /path/to/x', () => {
        const html = renderMsg('看 /path/to/x 结束')
        expect(html).not.toContain('class="slash-command-badge"')
        expect(html).toContain('/path/to/x')
    })

    it('不误伤 /foo(bar)', () => {
        const html = renderMsg('看 /foo(bar) 结束')
        expect(html).not.toContain('class="slash-command-badge"')
    })

    it('a/b/c 不识别（/ 前非空白，非独立词）', () => {
        const html = renderMsg('路径 a/b/c 结束')
        expect(html).not.toContain('class="slash-command-badge"')
    })

    it('命令名仅允许 [a-zA-Z0-9_-]', () => {
        const html = renderMsg('/board-2 详情')
        expect(html).toContain('class="slash-command-badge"')
        expect(html).toContain('/board-2')
    })
})
