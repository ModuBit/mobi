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

import { describe, expect, it } from 'vitest'
import { interpretKeyChunk } from '@/ui/switchKeys'

describe('interpretKeyChunk', () => {
    it('Ctrl-C（\\x03）解析为 exit', () => {
        expect(interpretKeyChunk('\x03')).toEqual([{ kind: 'exit' }])
    })

    it('一帧多键混合解析（Ctrl-C + 可打印 + 空格）', () => {
        expect(interpretKeyChunk('a\x03b c')).toEqual([
            { kind: 'printable', char: 'a' },
            { kind: 'exit' },
            { kind: 'printable', char: 'b' },
            { kind: 'space' },
            { kind: 'printable', char: 'c' },
        ])
    })

    it('Kitty CSI u 空格（无修饰 / 带修饰）解析为 space', () => {
        expect(interpretKeyChunk('\u001b[32u')).toEqual([{ kind: 'space' }])
        expect(interpretKeyChunk('\u001b[32;2u')).toEqual([{ kind: 'space' }])
    })

    it('Kitty key-release 序列（任意 codepoint）解析为 key-release', () => {
        // 按住任意键的释放事件（旧用例：\u001b[1:3u / \u001b[3:3u / \u001b[32;2:3u）
        expect(interpretKeyChunk('\u001b[1:3u')).toEqual([{ kind: 'key-release' }])
        expect(interpretKeyChunk('\u001b[3:3u')).toEqual([{ kind: 'key-release' }])
        expect(interpretKeyChunk('\u001b[32;2:3u')).toEqual([{ kind: 'key-release' }])
        expect(interpretKeyChunk('\u001b[32:3u')).toEqual([{ kind: 'key-release' }])
    })

    it('key-release 与可打印混合逐键拆分', () => {
        expect(interpretKeyChunk('a\u001b[1:3u')).toEqual([
            { kind: 'printable', char: 'a' },
            { kind: 'key-release' },
        ])
    })

    it('非空格 CSI u 序列（如回车编码）解析为 ignore', () => {
        expect(interpretKeyChunk('\u001b[13u')).toEqual([{ kind: 'ignore' }])
    })

    it('其他转义序列（方向键 / 单独 ESC）解析为 ignore', () => {
        expect(interpretKeyChunk('\u001b[A')).toEqual([{ kind: 'ignore' }])
        expect(interpretKeyChunk('\u001b')).toEqual([{ kind: 'ignore' }])
    })

    it('控制字符（\\r \\n \\t）忽略不产生意图', () => {
        expect(interpretKeyChunk('\r\n\t')).toEqual([])
    })

    it('中文等多字节可打印字符按 UTF-16 码元逐个解析', () => {
        const intents = interpretKeyChunk('你')
        expect(intents).toHaveLength(1)
        expect(intents[0]).toEqual({ kind: 'printable', char: '你' })
    })
})
