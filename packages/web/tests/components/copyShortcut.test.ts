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
import { resolveCopyShortcut } from '@/components/composer/copyShortcut'

describe('resolveCopyShortcut', () => {
    it('有选中文本时优先放行复制，即使有内容或正在运行', () => {
        expect(resolveCopyShortcut({
            hasSelection: true,
            text: 'hello',
            running: true,
            canAbort: true,
            abortPending: false,
        })).toBe('copy')
    })

    it('无选中 + 有内容 → 清空', () => {
        expect(resolveCopyShortcut({
            hasSelection: false,
            text: 'hello',
            running: false,
            canAbort: false,
            abortPending: false,
        })).toBe('clear')
    })

    it('无选中 + 有内容，即使 running 也优先清空（用户更可能想清空未提交的输入）', () => {
        expect(resolveCopyShortcut({
            hasSelection: false,
            text: 'hello',
            running: true,
            canAbort: true,
            abortPending: false,
        })).toBe('clear')
    })

    it('无选中 + 无内容 + running + 可中止 → 中止', () => {
        expect(resolveCopyShortcut({
            hasSelection: false,
            text: '',
            running: true,
            canAbort: true,
            abortPending: false,
        })).toBe('abort')
    })

    it('无选中 + 无内容 + 空闲 → 不处理', () => {
        expect(resolveCopyShortcut({
            hasSelection: false,
            text: '',
            running: false,
            canAbort: true,
            abortPending: false,
        })).toBe('none')
    })

    it('无选中 + 无内容 + running 但 abortPending → 不处理（避免重复中止）', () => {
        expect(resolveCopyShortcut({
            hasSelection: false,
            text: '',
            running: true,
            canAbort: true,
            abortPending: true,
        })).toBe('none')
    })

    it('无选中 + 无内容 + running 但无可用中止回调 → 不处理', () => {
        expect(resolveCopyShortcut({
            hasSelection: false,
            text: '',
            running: true,
            canAbort: false,
            abortPending: false,
        })).toBe('none')
    })

    it('有选中 + abortPending 仍优先放行复制', () => {
        expect(resolveCopyShortcut({
            hasSelection: true,
            text: '',
            running: true,
            canAbort: true,
            abortPending: true,
        })).toBe('copy')
    })
})
