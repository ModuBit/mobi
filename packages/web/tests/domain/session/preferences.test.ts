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
 * 新建会话偏好持久化：load/save 对 localStorage 的读写与异常兜底
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
    loadLastUsedProjectId,
    saveLastUsedProjectId,
} from '@/domain/session/preferences'

beforeEach(() => {
    localStorage.clear()
})

describe('最近使用的项目持久化', () => {
    it('未存过返回 null', () => {
        expect(loadLastUsedProjectId()).toBeNull()
    })
    it('save 后可 load 回同一 id', () => {
        saveLastUsedProjectId('p-1')
        expect(loadLastUsedProjectId()).toBe('p-1')
    })
    it('save 空串视为清除（项目被删/游离场景由调用方判定，此处不落脏值）', () => {
        saveLastUsedProjectId('p-1')
        saveLastUsedProjectId('')
        expect(loadLastUsedProjectId()).toBeNull()
    })
})
