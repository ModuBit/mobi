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

/**
 * Markdown 渲染器 flag（markdownRenderer）单元测试
 * 验证：默认旧栈 / 切新栈持久化 / 切回旧栈清 key / 非法值兜底旧栈
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { getMarkdownRenderer, setMarkdownRenderer, isStreamdownEnabled } from '@/core/lib/markdownRenderer'

describe('markdownRenderer', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('默认返回旧栈（未设置时）', () => {
        expect(getMarkdownRenderer()).toBe('x-markdown')
        expect(isStreamdownEnabled()).toBe(false)
    })

    it('切到 streamdown 后持久化并可读回', () => {
        setMarkdownRenderer('streamdown')
        expect(localStorage.getItem('mobi-md-renderer')).toBe('streamdown')
        expect(getMarkdownRenderer()).toBe('streamdown')
        expect(isStreamdownEnabled()).toBe(true)
    })

    it('切回旧栈清除 localStorage key', () => {
        setMarkdownRenderer('streamdown')
        setMarkdownRenderer('x-markdown')
        expect(localStorage.getItem('mobi-md-renderer')).toBeNull()
        expect(getMarkdownRenderer()).toBe('x-markdown')
    })

    it('localStorage 值非法时兜底旧栈', () => {
        localStorage.setItem('mobi-md-renderer', 'bogus')
        expect(getMarkdownRenderer()).toBe('x-markdown')
        expect(isStreamdownEnabled()).toBe(false)
    })
})
