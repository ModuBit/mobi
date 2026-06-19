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
import { stripAnsi } from '@/domain/chat/ansi'

describe('stripAnsi', () => {
    it('剥离单个 SGR 颜色码', () => {
        expect(stripAnsi('\x1B[31m红色\x1B[0m')).toBe('红色')
    })

    it('保留无颜色码的纯文本', () => {
        expect(stripAnsi('普通文本')).toBe('普通文本')
    })

    it('剥离多个 SGR 颜色码（含复合参数 1;31）', () => {
        expect(stripAnsi('\x1B[1;31m粗体红\x1B[0m 纯文本 \x1B[32m绿\x1B[0m')).toBe('粗体红 纯文本 绿')
    })

    it('空字符串原样返回', () => {
        expect(stripAnsi('')).toBe('')
    })

    it('不剥离非 SGR 的 CSI 序列（如光标移动 [2K）', () => {
        // 仅剥离以 m 结尾的 SGR；[2K（清行）等不受影响
        expect(stripAnsi('\x1B[2K清行')).toBe('\x1B[2K清行')
    })
})
