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
 * viz 档文档组装/校验单测（visualize-runtime 票 02）。
 *
 * 契约面：fragment 拒完整文档标记与超限/空内容；组装产物结构稳定
 * （token/工具类在 head、fragment 原文在 body、运行时其后）——这些是
 * 「换实现后仍应成立」的行为断言，样式/脚本的具体内容不在此锁。
 */

import { describe, test, expect } from 'bun:test'
import {
    VIZ_FRAGMENT_MAX_BYTES,
    assembleVizDocument,
    validateVizFragment,
    vizFragmentErrorDocument,
} from '../../../src/web/vizRuntime/assembleVizDocument'

describe('validateVizFragment', () => {
    test('合法 fragment 通过', () => {
        expect(validateVizFragment('<div id="root">hi</div>', 26)).toEqual({ ok: true })
        expect(validateVizFragment('<style>.a{color:red}</style><div></div>', 100)).toEqual({ ok: true })
    })

    test('完整文档标记拒绝（大小写不敏感；doctype/html/head/body）', () => {
        for (const doc of ['<!doctype html><div></div>', '<html><div></div>', '< body >', '<HEAD>', '<!DOCTYPE html>']) {
            const result = validateVizFragment(doc, doc.length)
            expect(result.ok).toBe(false)
        }
    })

    test('空/纯空白拒绝', () => {
        expect(validateVizFragment('', 0).ok).toBe(false)
        expect(validateVizFragment('   \n  ', 6).ok).toBe(false)
    })

    test('超限拒绝（1MB）', () => {
        expect(validateVizFragment('<div></div>', VIZ_FRAGMENT_MAX_BYTES + 1).ok).toBe(false)
        expect(validateVizFragment('<div></div>', VIZ_FRAGMENT_MAX_BYTES).ok).toBe(true)
    })
})

describe('assembleVizDocument', () => {
    test('组装产物：doctype 文档、样式在 head、状态桥先于 fragment、运行时其后', () => {
        const fragment = '<div id="chart">data</div><script>window.__t = 1</script>'
        const doc = assembleVizDocument(fragment, 'sales chart')
        expect(doc.startsWith('<!doctype html>')).toBe(true)
        // title 转义进 head
        expect(doc).toContain('<title>sales chart</title>')
        // fragment 原文完整保留（模型脚本一字不动）
        expect(doc).toContain(fragment)
        // token/工具类与运行时标签存在
        expect(doc).toContain('--viz-bg')
        expect(doc).toContain('.viz-grid')
        expect(doc).toContain('data-tooltip')
        // 状态桥（票 03）在 fragment 之前：fragment 首渲染即可 getWidgetState 恢复
        expect(doc).toContain('setWidgetState')
        expect(doc.indexOf('setWidgetState')).toBeLessThan(doc.indexOf(fragment))
        // 顺序：fragment 早于交互运行时（运行时事件委托在其后仍接管）
        expect(doc.indexOf(fragment)).toBeLessThan(doc.lastIndexOf('viz-carousel-controls'))
    })

    test('日历挂钩：fragment 提及 viz-calendar 时注入组件脚本且在 fragment 之前', () => {
        const withCalendar = assembleVizDocument('<viz-calendar date="2026-10-16"></viz-calendar>')
        expect(withCalendar).toContain('customElements.define')
        // 注册在 fragment 解析前（connectedCallback 同步建 shadow，无 upgrade 闪烁）
        expect(withCalendar.indexOf("customElements.define('viz-calendar'")).toBeLessThan(
            withCalendar.indexOf('<viz-calendar date'),
        )
        // 不提及时产物不含组件脚本（按需注入）
        const plain = assembleVizDocument('<div></div>')
        expect(plain).not.toContain('customElements.define')
        expect(plain).not.toContain('<viz-calendar')
    })

    test('title HTML 转义', () => {
        expect(assembleVizDocument('<div></div>', '<x>&"')).toContain('<title>&lt;x&gt;&amp;&quot;</title>')
    })
})

describe('vizFragmentErrorDocument', () => {
    test('错误信息转义 + role=alert', () => {
        const doc = vizFragmentErrorDocument('<script>alert(1)</script>')
        expect(doc).toContain('role="alert"')
        expect(doc).not.toContain('<script>alert')
    })
})
