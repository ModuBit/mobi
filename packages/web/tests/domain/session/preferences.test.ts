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
    loadLastUsedWorkspaceId,
    loadPreferredEffort,
    loadPreferredModel,
    saveLastUsedWorkspaceId,
    savePreferredEffort,
    savePreferredModel,
} from '@/domain/session/preferences'

beforeEach(() => {
    localStorage.clear()
})

describe('模型偏好持久化', () => {
    it('未存过回退 auto', () => {
        expect(loadPreferredModel()).toBe('auto')
    })

    it('清单外的合法模型名（代理模型 / 带标签变体）刷新后仍生效', () => {
        savePreferredModel('opus[1m]')
        expect(loadPreferredModel()).toBe('opus[1m]')
        savePreferredModel('deepseek-v3')
        expect(loadPreferredModel()).toBe('deepseek-v3')
    })

    it('空值不当作有效偏好，仍回退 auto', () => {
        savePreferredModel('')
        expect(loadPreferredModel()).toBe('auto')
        savePreferredModel('   ')
        expect(loadPreferredModel()).toBe('auto')
    })
})

describe('effort 偏好持久化', () => {
    it('可落盘四档正常往返', () => {
        savePreferredEffort('xhigh')
        expect(loadPreferredEffort()).toBe('xhigh')
    })

    it('session-only 的 max 不写进偏好（保留上次的可落盘档位）', () => {
        savePreferredEffort('high')
        savePreferredEffort('max')
        expect(loadPreferredEffort()).toBe('high')
    })
})

describe('最近使用的工作区持久化', () => {
    it('未存过返回 null', () => {
        expect(loadLastUsedWorkspaceId()).toBeNull()
    })
    it('save 后可 load 回同一 id', () => {
        saveLastUsedWorkspaceId('p-1')
        expect(loadLastUsedWorkspaceId()).toBe('p-1')
    })
    it('save 空串视为清除（工作区被删/游离场景由调用方判定，此处不落脏值）', () => {
        saveLastUsedWorkspaceId('p-1')
        saveLastUsedWorkspaceId('')
        expect(loadLastUsedWorkspaceId()).toBeNull()
    })
})
