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

    it('HTML 块一旦出现：其后全部不切（保守——HTML 内空行语义不可靠）', () => {
        const text = 'para\n\n<div>\n\nhtml 内空行\n</div>\n\npara2 流式中'
        const { stable } = expectInvariant(text)
        expect(stable).toBe('para\n\n')
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
})
