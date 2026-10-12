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
 * app bridge 协议规格（generative-ui 票 06）：白名单（type/action 唯一值）、schema
 * （text 类型/trim 非空/限长，超限整体拒绝不截断）、脚本注入幂等、限流窗口。
 * 断言对象是「换实现仍应成立」的外部行为：什么消息进得了 intake、什么被拒。
 */

import { describe, it, expect } from 'vitest'
import {
    APP_BRIDGE_MIN_INTERVAL_MS,
    APP_BRIDGE_TEXT_MAX,
    createAppBridgeRateLimiter,
    injectAppBridgeScript,
    parseAppBridgeMessage,
} from '@/features/files/sandboxAppHost'

const valid = { type: 'mobi-app', action: 'issueNewTurn', text: '按当前选择继续' }

describe('parseAppBridgeMessage（白名单 + schema）', () => {
    it('白名单消息通过并 trim 文本', () => {
        expect(parseAppBridgeMessage({ ...valid, text: '  继续执行  ' })).toEqual({ text: '继续执行' })
    })

    it('非白名单 type/action → null（第二通道不存在即拒）', () => {
        expect(parseAppBridgeMessage({ ...valid, type: 'other' })).toBeNull()
        expect(parseAppBridgeMessage({ ...valid, action: 'openLink' })).toBeNull()
        expect(parseAppBridgeMessage({ type: 'mobi-app' })).toBeNull()
    })

    it('text 非 string / trim 后空 → null', () => {
        expect(parseAppBridgeMessage({ ...valid, text: 123 })).toBeNull()
        expect(parseAppBridgeMessage({ ...valid, text: null })).toBeNull()
        expect(parseAppBridgeMessage({ ...valid, text: '   ' })).toBeNull()
    })

    it('超限整体拒绝（不截断——截断会静默改语义）', () => {
        expect(parseAppBridgeMessage({ ...valid, text: 'a'.repeat(APP_BRIDGE_TEXT_MAX + 1) })).toBeNull()
        expect(parseAppBridgeMessage({ ...valid, text: 'a'.repeat(APP_BRIDGE_TEXT_MAX) })).toEqual({ text: 'a'.repeat(APP_BRIDGE_TEXT_MAX) })
    })

    it('非对象 / null / 数组 → null', () => {
        expect(parseAppBridgeMessage(null)).toBeNull()
        expect(parseAppBridgeMessage('mobi-app')).toBeNull()
        expect(parseAppBridgeMessage([valid])).toBeNull()
    })
})

describe('injectAppBridgeScript（幂等注入）', () => {
    it('注入一次后重复调用不重复追加；脚本含 MobiApp API', () => {
        const doc = document.implementation.createHTMLDocument('test')
        injectAppBridgeScript(doc)
        const first = doc.getElementById('mobi-app-bridge')
        expect(first).not.toBeNull()
        expect(first!.textContent).toContain('MobiApp')
        expect(first!.textContent).toContain('issueNewTurn')
        injectAppBridgeScript(doc)
        expect(doc.querySelectorAll('#mobi-app-bridge')).toHaveLength(1)
    })

    it('空文档静默跳过', () => {
        expect(() => injectAppBridgeScript(null)).not.toThrow()
    })
})

describe('createAppBridgeRateLimiter（限流窗口）', () => {
    it('窗口内只放行第一条，出窗后恢复', () => {
        let now = 0
        const allow = createAppBridgeRateLimiter(() => now)
        expect(allow()).toBe(true)
        now = APP_BRIDGE_MIN_INTERVAL_MS - 1
        expect(allow()).toBe(false)
        now = APP_BRIDGE_MIN_INTERVAL_MS
        expect(allow()).toBe(true)
    })

    it('每个限流器实例独立（不同 app 互不影响）', () => {
        const a = createAppBridgeRateLimiter(() => 0)
        const b = createAppBridgeRateLimiter(() => 0)
        expect(a()).toBe(true)
        expect(b()).toBe(true)
    })
})
