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
 * uuid 工具函数单元测试
 *
 * 重点回归：非安全上下文（局域网 IP + HTTP）下 crypto.randomUUID 不可用，
 * 必须正确 fallback 到 getRandomValues，仍返回合法 v4 UUID。
 */

import { describe, expect, it, afterEach } from 'vitest'
import { uuid } from '@/core/lib/uuid'

// RFC 4122 v4 UUID 正则：校验 version(4) 与 variant(8/9/a/b) 位
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('uuid', () => {
    it('返回符合 RFC 4122 v4 格式的 UUID', () => {
        expect(uuid()).toMatch(UUID_V4)
    })

    it('多次调用生成唯一值', () => {
        const ids = new Set(Array.from({ length: 100 }, () => uuid()))
        expect(ids.size).toBe(100)
    })

    /**
     * 回归：移动端通过局域网 IP + HTTP 访问时，crypto.randomUUID 不存在。
     * 这是本次修复的核心场景，必须保证 fallback 不抛错且返回合法 v4 UUID。
     */
    describe('非安全上下文 fallback（crypto.randomUUID 不可用）', () => {
        // jsdom 的 randomUUID 定义在 Crypto.prototype 上，需改 prototype 才能屏蔽
        const proto = Object.getPrototypeOf(crypto)
        const originalDesc = Object.getOwnPropertyDescriptor(proto, 'randomUUID')

        afterEach(() => {
            if (originalDesc) {
                Object.defineProperty(proto, 'randomUUID', originalDesc)
            }
        })

        it('randomUUID 缺失时不抛错，仍返回合法 v4 UUID', () => {
            Object.defineProperty(proto, 'randomUUID', { value: undefined, configurable: true })
            const id = uuid()
            expect(id).toMatch(UUID_V4)
        })

        it('randomUUID 缺失时多次调用仍唯一', () => {
            Object.defineProperty(proto, 'randomUUID', { value: undefined, configurable: true })
            const ids = new Set(Array.from({ length: 50 }, () => uuid()))
            expect(ids.size).toBe(50)
        })
    })
})
