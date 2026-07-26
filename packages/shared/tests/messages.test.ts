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
import {
    isRoleWrappedRecord,
    unwrapRoleWrappedRecordEnvelope,
    isClaudeChatVisibleSystemSubtype,
    isClaudeChatVisibleMessage,
} from '../src/messages'

describe('isRoleWrappedRecord', () => {
    it('含 role 和 content 的对象返回 true', () => {
        expect(isRoleWrappedRecord({ role: 'user', content: 'hello' })).toBe(true)
        expect(isRoleWrappedRecord({ role: 'assistant', content: { text: 'hi' } })).toBe(true)
        // 含额外字段也应返回 true
        expect(isRoleWrappedRecord({ role: 'user', content: 'hi', meta: {} })).toBe(true)
    })

    it('缺少 role 返回 false', () => {
        expect(isRoleWrappedRecord({ content: 'hello' })).toBe(false)
    })

    it('缺少 content 返回 false', () => {
        expect(isRoleWrappedRecord({ role: 'user' })).toBe(false)
    })

    it('非对象返回 false', () => {
        expect(isRoleWrappedRecord(null)).toBe(false)
        expect(isRoleWrappedRecord(undefined)).toBe(false)
        expect(isRoleWrappedRecord('string')).toBe(false)
        expect(isRoleWrappedRecord(42)).toBe(false)
    })
})

describe('unwrapRoleWrappedRecordEnvelope', () => {
    const validRecord = { role: 'user', content: 'hello' }

    it('直接 record 直接解包', () => {
        const result = unwrapRoleWrappedRecordEnvelope(validRecord)
        expect(result).toEqual(validRecord)
    })

    it('message 字段解包', () => {
        const wrapper = { message: validRecord }
        const result = unwrapRoleWrappedRecordEnvelope(wrapper)
        expect(result).toEqual(validRecord)
    })

    it('data.message 解包', () => {
        const wrapper = { data: { message: validRecord } }
        const result = unwrapRoleWrappedRecordEnvelope(wrapper)
        expect(result).toEqual(validRecord)
    })

    it('payload.message 解包', () => {
        const wrapper = { payload: { message: validRecord } }
        const result = unwrapRoleWrappedRecordEnvelope(wrapper)
        expect(result).toEqual(validRecord)
    })

    it('无法解包返回 null', () => {
        expect(unwrapRoleWrappedRecordEnvelope(null)).toBeNull()
        expect(unwrapRoleWrappedRecordEnvelope(undefined)).toBeNull()
        expect(unwrapRoleWrappedRecordEnvelope({})).toBeNull()
        expect(unwrapRoleWrappedRecordEnvelope({ foo: 'bar' })).toBeNull()
        expect(unwrapRoleWrappedRecordEnvelope('string')).toBeNull()
        expect(unwrapRoleWrappedRecordEnvelope(42)).toBeNull()
    })
})

describe('isClaudeChatVisibleSystemSubtype', () => {
    it('api_error 返回 true', () => {
        expect(isClaudeChatVisibleSystemSubtype('api_error')).toBe(true)
    })

    it('api_retry 返回 true', () => {
        expect(isClaudeChatVisibleSystemSubtype('api_retry')).toBe(true)
    })

    it('compact_boundary 返回 true', () => {
        expect(isClaudeChatVisibleSystemSubtype('compact_boundary')).toBe(true)
    })

    it('turn_duration 返回 true', () => {
        expect(isClaudeChatVisibleSystemSubtype('turn_duration')).toBe(true)
    })

    it('microcompact_boundary 返回 true', () => {
        expect(isClaudeChatVisibleSystemSubtype('microcompact_boundary')).toBe(true)
    })

    it('task_started 返回 true', () => {
        expect(isClaudeChatVisibleSystemSubtype('task_started')).toBe(true)
    })

    it('task_updated 返回 true', () => {
        expect(isClaudeChatVisibleSystemSubtype('task_updated')).toBe(true)
    })

    it('init 返回 false', () => {
        expect(isClaudeChatVisibleSystemSubtype('init')).toBe(false)
    })

    it('非字符串返回 false', () => {
        expect(isClaudeChatVisibleSystemSubtype(123)).toBe(false)
        expect(isClaudeChatVisibleSystemSubtype(null)).toBe(false)
        expect(isClaudeChatVisibleSystemSubtype(undefined)).toBe(false)
    })
})

describe('isClaudeChatVisibleMessage', () => {
    it('非 system 且非 ephemeral 顶层类型返回 true', () => {
        expect(isClaudeChatVisibleMessage({ type: 'user' })).toBe(true)
        expect(isClaudeChatVisibleMessage({ type: 'assistant' })).toBe(true)
        expect(isClaudeChatVisibleMessage({ type: 'tool_result' })).toBe(true)
    })

    it('tool_progress / tool_use_summary 已接入 handler，视为可见', () => {
        // 这两类 ephemeral 消息由 web normalize 产出 tool-progress / tool-use-summary 事件，
        // 挂到对应工具卡片（耗时显示 / 摘要），不再被 JSON dump 当文本渲染
        expect(isClaudeChatVisibleMessage({ type: 'tool_progress' })).toBe(true)
        expect(isClaudeChatVisibleMessage({ type: 'tool_use_summary' })).toBe(true)
    })

    it('system + 可见子类型返回 true', () => {
        expect(isClaudeChatVisibleMessage({ type: 'system', subtype: 'api_error' })).toBe(true)
        expect(isClaudeChatVisibleMessage({ type: 'system', subtype: 'compact_boundary' })).toBe(true)
    })

    it('system + 不可见子类型返回 false', () => {
        expect(isClaudeChatVisibleMessage({ type: 'system', subtype: 'init' })).toBe(false)
        expect(isClaudeChatVisibleMessage({ type: 'system', subtype: 'other' })).toBe(false)
    })

    it('system 无 subtype 返回 false', () => {
        expect(isClaudeChatVisibleMessage({ type: 'system' })).toBe(false)
    })
})
