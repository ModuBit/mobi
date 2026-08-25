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
import { splitStablePrefix } from '@/core/lib/markdownSplit'

/**
 * 流式增量 Markdown 的稳定前缀拆分规格。
 *
 * 不变量（所有用例共同断言）：stable + tail === text——拆分是纯位置切割，
 * 两段拼回必须是原文；stable 是「最后一个安全切点（块级边界）之前」的文本，
 * 完成块永不再变，可整体跳过 re-parse。
 */

/** 断言拼回不变式 */
function expectInvariant(text: string) {
    const { stable, tail } = splitStablePrefix(text)
    expect(stable + tail).toBe(text)
    return { stable, tail }
}

describe('splitStablePrefix', () => {
    it('多段落后正在流式的末段：切在最后一个空行，stable 含全部完成段落', () => {
        const { stable, tail } = expectInvariant('para1\n\npara2\n\npara3 流式中')
        expect(stable).toBe('para1\n\npara2\n\n')
        expect(tail).toBe('para3 流式中')
    })

    it('无空行单段（流式开头）：无安全切点，全部进 tail', () => {
        const { stable, tail } = expectInvariant('only paragraph streaming')
        expect(stable).toBe('')
        expect(tail).toBe('only paragraph streaming')
    })

    it('空文本与纯空白：不切', () => {
        expect(splitStablePrefix('')).toEqual({ stable: '', tail: '' })
        expect(splitStablePrefix('\n\n')).toEqual({ stable: '', tail: '\n\n' })
    })

    it('文本以空行结尾（turn 静止）：全文 stable', () => {
        const { stable, tail } = expectInvariant('para1\n\npara2\n\n')
        expect(stable).toBe('para1\n\npara2\n\n')
        expect(tail).toBe('')
    })

    it('未闭合 code fence：fence 内无切点，fence 之前的内容可切', () => {
        const text = 'para1\n\n```ts\nconst a = 1\n仍流式中'
        const { stable, tail } = expectInvariant(text)
        expect(stable).toBe('para1\n\n')
        expect(tail).toBe('```ts\nconst a = 1\n仍流式中')
    })

    it('已闭合 fence 后跟新段落：切点在 fence 之后的空行', () => {
        const text = 'para1\n\n```ts\nconst a = 1\n```\n\n下一段流式中'
        const { stable, tail } = expectInvariant(text)
        expect(stable).toBe('para1\n\n```ts\nconst a = 1\n```\n\n')
        expect(tail).toBe('下一段流式中')
    })

    it('fence 内的空行不构成切点（fence 未闭合）', () => {
        const text = 'para\n\n```\ncode line\n\nstill inside fence'
        const { stable } = expectInvariant(text)
        expect(stable).toBe('para\n\n')
    })

    it('列表进行中：列表块内不切（含跨空行的列表延续）', () => {
        // 列表项间空行仍属同一列表，切开会导致 ol 编号重置/间距断裂
        const { stable } = expectInvariant('- a\n- b\n- c 流式中')
        expect(stable).toBe('')

        const { stable: stable2 } = expectInvariant('- a\n\n- b\n\n- c')
        expect(stable2).toBe('')
    })

    it('列表块结束（其后出现非列表段落）后的空行可切', () => {
        const text = '- a\n- b\n\n总结段落流式中'
        const { stable, tail } = expectInvariant(text)
        expect(stable).toBe('')
        expect(tail).toBe(text)

        // 列表 + 段落 + 段落：最后一个完成段落后的空行是安全切点，
        // 列表被包含进 stable（此时列表已确定完整——其后已是非列表非空行）
        const text2 = '- a\n- b\n\npara1 完成\n\npara2 流式中'
        const { stable: s2 } = expectInvariant(text2)
        expect(s2).toBe('- a\n- b\n\npara1 完成\n\n')
    })

    it('列表后的空行后紧跟列表延续（缩进/marker 行）：不切', () => {
        const { stable } = expectInvariant('- a\n\n- b\n\n  缩进续行')
        expect(stable).toBe('')
    })

    it('引用块：quote 后空行可切（markdown 规范空行结束 quote 块）', () => {
        const text = '> quote 内容\n\n新段落流式中'
        const { stable, tail } = expectInvariant(text)
        expect(stable).toBe('> quote 内容\n\n')
        expect(tail).toBe('新段落流式中')
    })

    it('表格块：表内无空行天然不切，表后空行可切', () => {
        const text = '| a | b |\n|---|---|\n| 1 | 2 |\n\n表后段落流式中'
        const { stable, tail } = expectInvariant(text)
        expect(stable).toBe('| a | b |\n|---|---|\n| 1 | 2 |\n\n')
        expect(tail).toBe('表后段落流式中')
    })

    it('HTML 块：块内不切，块结束后恢复可切', () => {
        // HTML 块行是延续块：块内（含块内空行后的 tag 内容）不设切点
        const { stable } = expectInvariant('para\n\n<div>\n\nhtml 内空行\n</div>\n\npara2 流式中')
        // '</div>' 后的空行到 'para2' 时延续仍被视为可能继续——保守把 HTML 块留 tail
        expect(stable).toBe('para\n\n')

        // HTML 块结束（空行 + 非 tag 普通行）确认后，后续块边界可切：
        // CommonMark HTML 块结束于空行后的非 tag 内容，marked 同此解析——切开与渲染器一致
        const { stable: s2, tail } = expectInvariant('para\n\n<div>\n</div>\n\n中间段。\n\ntail 流式中')
        expect(s2).toBe('para\n\n<div>\n</div>\n\n中间段。\n\n')
        expect(tail).toBe('tail 流式中')
    })

    it('autolink（<https://…>、<user@host>）不是 HTML 块，不锁死后续切点', () => {
        const { stable, tail } = expectInvariant('para\n\n<https://example.com>\n\npara2 流式中')
        expect(stable).toBe('para\n\n<https://example.com>\n\n')
        expect(tail).toBe('para2 流式中')

        const { stable: s2 } = expectInvariant('para\n\n<user@host>\n\npara2 流式中')
        expect(s2).toBe('para\n\n<user@host>\n\n')
    })

    it('嵌套 fence：外层 ```` 内的 ``` 不提前闭合，切点在整块之后', () => {
        // LLM 展示 markdown 示例的常见形态：4 反引号包裹、内含 3 反引号
        const text = 'para1\n\n````js\nconst a = `code`\n```\ninner\n````\n\n尾部段落流式中'
        const { stable, tail } = expectInvariant(text)
        expect(stable).toBe('para1\n\n````js\nconst a = `code`\n```\ninner\n````\n\n')
        expect(tail).toBe('尾部段落流式中')
    })

    it('fence 闭栏长度不足不闭合（```` 包 ~~~ 不互闭、短闭合行无效）', () => {
        const { stable } = expectInvariant('para\n\n~~~\ncode ``` \n内层\n~~~\n\ntail 流式中')
        expect(stable).toBe('para\n\n~~~\ncode ``` \n内层\n~~~\n\n')
    })

    it('setext 标题（下划线式）：标题与其下划线间无空行天然不切', () => {
        const text = 'Title\n===\n\n正文流式中'
        const { stable, tail } = expectInvariant(text)
        expect(stable).toBe('Title\n===\n\n')
        expect(tail).toBe('正文流式中')
    })

    it('连续空行：切点取最后一个空行行尾', () => {
        const { stable, tail } = expectInvariant('para1\n\n\n\npara2 流式中')
        expect(stable).toBe('para1\n\n\n\n')
        expect(tail).toBe('para2 流式中')
    })

    it('长文本性能形态：切点单调前移（模拟逐帧调用无异常）', () => {
        let text = ''
        for (let i = 0; i < 200; i++) text += `段落 ${i} 的内容。\n\n`
        const { stable } = splitStablePrefix(text)
        // 全部块完成 + 尾部空行 → 全文 stable
        expect(stable).toBe(text)
    })

    describe('增量恢复（prevStable）', () => {
        it('逐帧增长：增量结果与全量结果恒等，且 stable 单调不减', () => {
            // 模拟流式逐字：从段首逐步增长到完整文本
            const full = [
                'para1 完成段。\n\n',
                '```ts\nconst a = 1\n```\n\n',
                '- 列表项 A\n- 列表项 B\n\n',
                'para2 完成段。\n\n',
                '尾部流式中',
            ].join('')
            let prevStable = ''
            for (let n = 1; n <= full.length; n += 7) {
                const text = full.slice(0, n)
                const inc = splitStablePrefix(text, prevStable || undefined)
                const full2 = splitStablePrefix(text)
                expect(inc).toEqual(full2)
                expect(inc.stable.length).toBeGreaterThanOrEqual(Math.min(prevStable.length, text.length))
                prevStable = inc.stable
            }
        })

        it('prevStable 非前缀（文本收缩）时自动回退，结果与全量一致', () => {
            const text = '新内容 para\n\n尾'
            const prev = '旧的前缀 xyz\n\n'
            expect(splitStablePrefix(text, prev)).toEqual(splitStablePrefix(text))
        })

        it('大文本增量只扫尾部：50k 字符重复调用不异常且结果正确', () => {
            let text = ''
            for (let i = 0; i < 2000; i++) text += `第 ${i} 段内容。\n\n`
            text += '尾部流式中'
            let prev = ''
            // 模拟揭示推进：stable 建立后逐帧 +1 字符追加
            let result = splitStablePrefix(text, prev || undefined)
            expect(result.stable.length).toBeGreaterThan(0)
            for (let i = 0; i < 50; i++) {
                result = splitStablePrefix(text + 'x'.repeat(i), result.stable)
            }
            expect(result.stable + result.tail).toContain('尾部流式中')
        })
    })
})
