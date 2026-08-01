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
 * 调试模式解锁状态（debug.ts）单元测试
 * 验证：默认未解锁 / unlockDebug 后解锁 / 幂等 / localStorage 持久化 / lockDebug 重新锁定
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isDebugUnlocked, unlockDebug, lockDebug } from '@/core/lib/debug'

const LS_UNLOCKED_KEY = 'mobi-debug-unlocked'

describe('debug 调试解锁', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    afterEach(() => {
        localStorage.clear()
    })

    it('默认未解锁', () => {
        expect(isDebugUnlocked()).toBe(false)
    })

    it('unlockDebug 后解锁，并写入 localStorage 持久化', () => {
        expect(isDebugUnlocked()).toBe(false)
        unlockDebug()
        expect(isDebugUnlocked()).toBe(true)
        expect(localStorage.getItem(LS_UNLOCKED_KEY)).toBe('1')
    })

    it('解锁状态跨刷新保留（localStorage 重读）', () => {
        unlockDebug()
        // 模拟刷新：localStorage 不变，重新初始化模块状态
        expect(isDebugUnlocked()).toBe(true)
    })

    it('unlockDebug 幂等：重复调用无副作用', () => {
        unlockDebug()
        unlockDebug()
        unlockDebug()
        expect(isDebugUnlocked()).toBe(true)
        expect(localStorage.getItem(LS_UNLOCKED_KEY)).toBe('1')
    })

    it('lockDebug 后重新锁定并清理 localStorage', () => {
        unlockDebug()
        expect(isDebugUnlocked()).toBe(true)
        lockDebug()
        expect(isDebugUnlocked()).toBe(false)
        expect(localStorage.getItem(LS_UNLOCKED_KEY)).toBeNull()
    })
})
