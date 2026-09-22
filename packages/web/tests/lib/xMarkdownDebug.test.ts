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

import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
    initXMarkdownDebugFromQuery,
    isXMarkdownDebugEnabled,
} from '@/core/lib/xMarkdownDebug'

describe('xMarkdownDebug', () => {
    beforeEach(() => {
        localStorage.clear()
        // 模块缓存随 init 刷新，每个用例重置到「无 query」基线
        window.history.replaceState(null, '', '/')
        initXMarkdownDebugFromQuery()
    })

    it('默认关闭', () => {
        expect(isXMarkdownDebugEnabled()).toBe(false)
    })

    it('?xmd-debug=1 → 写入 localStorage 并开启（刷新后仍开）', () => {
        window.history.replaceState(null, '', '/?xmd-debug=1')
        initXMarkdownDebugFromQuery()
        expect(localStorage.getItem('mobi-xmd-debug-enabled')).toBe('1')

        // 模拟刷新：query 已移除，localStorage 常驻
        window.history.replaceState(null, '', '/')
        initXMarkdownDebugFromQuery()
        expect(isXMarkdownDebugEnabled()).toBe(true)
    })

    it('?xmd-debug=0 → 清除 localStorage 并关闭', () => {
        localStorage.setItem('mobi-xmd-debug-enabled', '1')
        window.history.replaceState(null, '', '/?xmd-debug=0')
        initXMarkdownDebugFromQuery()
        expect(localStorage.getItem('mobi-xmd-debug-enabled')).toBeNull()
        expect(isXMarkdownDebugEnabled()).toBe(false)
    })

    it('生产构建恒关（即使 localStorage 已开）', () => {
        vi.stubEnv('DEV', false as unknown as boolean)
        localStorage.setItem('mobi-xmd-debug-enabled', '1')
        initXMarkdownDebugFromQuery()
        expect(isXMarkdownDebugEnabled()).toBe(false)
        vi.unstubAllEnvs()
    })
})
