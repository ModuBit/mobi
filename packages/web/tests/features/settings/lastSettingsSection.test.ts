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

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const debugUnlocked = { value: false }
vi.mock('@/core/lib/debug', () => ({ isDebugUnlocked: () => debugUnlocked.value }))

import {
    readLastSettingsSection,
    writeLastSettingsSection,
} from '@/features/settings/sections/lastSettingsSection'

describe('上次访问分区存取', () => {
    beforeEach(() => {
        debugUnlocked.value = false
        localStorage.clear()
    })

    afterEach(() => {
        localStorage.clear()
    })

    it('无记录返回 null', () => {
        expect(readLastSettingsSection()).toBeNull()
    })

    it('写入后读回一致', () => {
        writeLastSettingsSection('memory')
        expect(readLastSettingsSection()).toBe('memory')
    })

    it('读时不存在的分区 id 返回 null（不被脏数据击穿）', () => {
        localStorage.setItem('settings.lastSection', JSON.stringify('hacked'))
        expect(readLastSettingsSection()).toBeNull()
    })

    it('分区当前不可见（debug 未解锁）返回 null；解锁后可见', () => {
        writeLastSettingsSection('debug')
        expect(readLastSettingsSection()).toBeNull()
        debugUnlocked.value = true
        expect(readLastSettingsSection()).toBe('debug')
    })

    it('存储内容损坏（非法 JSON）返回 null 不抛异常', () => {
        localStorage.setItem('settings.lastSection', '{broken')
        expect(readLastSettingsSection()).toBeNull()
    })
})
