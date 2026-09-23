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
    classifyMessage,
    isClaudeChatVisibleSystemSubtype,
    isClaudeChatVisibleMessage,
} from '../src/messageClassification'

describe('classifyMessage', () => {
    describe('discard 规则', () => {
        it('thinking_tokens → discard', () => {
            expect(classifyMessage('system', 'thinking_tokens')).toBe('discard')
        })

        it('hook_started → discard', () => {
            expect(classifyMessage('system', 'hook_started')).toBe('discard')
        })

        it('hook_progress → discard', () => {
            expect(classifyMessage('system', 'hook_progress')).toBe('discard')
        })

        it('hook_response → discard', () => {
            expect(classifyMessage('system', 'hook_response')).toBe('discard')
        })

        it('plugin_install → discard', () => {
            expect(classifyMessage('system', 'plugin_install')).toBe('discard')
        })

        it('files_persisted → discard', () => {
            expect(classifyMessage('system', 'files_persisted')).toBe('discard')
        })

        it('auth_status → discard', () => {
            expect(classifyMessage('auth_status')).toBe('discard')
        })

        it('rate_limit_event → discard', () => {
            expect(classifyMessage('rate_limit_event')).toBe('discard')
        })

        it('command_lifecycle → discard（排队生命周期回执，控制帧非对话内容）', () => {
            expect(classifyMessage('command_lifecycle')).toBe('discard')
        })
    })

    describe('ephemeral 规则', () => {
        it('task_progress → ephemeral', () => {
            expect(classifyMessage('system', 'task_progress')).toBe('ephemeral')
        })

        it('task_started → ephemeral', () => {
            expect(classifyMessage('system', 'task_started')).toBe('ephemeral')
        })

        it('task_updated → ephemeral', () => {
            expect(classifyMessage('system', 'task_updated')).toBe('ephemeral')
        })

        it('task_notification → ephemeral', () => {
            expect(classifyMessage('system', 'task_notification')).toBe('ephemeral')
        })

        it('tool_progress → ephemeral', () => {
            expect(classifyMessage('tool_progress')).toBe('ephemeral')
        })

        it('tool_use_summary → ephemeral', () => {
            expect(classifyMessage('tool_use_summary')).toBe('ephemeral')
        })

        it('prompt_suggestion → ephemeral', () => {
            expect(classifyMessage('prompt_suggestion')).toBe('ephemeral')
        })

        it('status → ephemeral', () => {
            expect(classifyMessage('system', 'status')).toBe('ephemeral')
        })
    })

    describe('persistent 默认', () => {
        it('assistant → persistent', () => {
            expect(classifyMessage('assistant')).toBe('persistent')
        })

        it('user → persistent', () => {
            expect(classifyMessage('user')).toBe('persistent')
        })

        it('result → persistent', () => {
            expect(classifyMessage('result')).toBe('persistent')
        })

        it('system:init → persistent', () => {
            expect(classifyMessage('system', 'init')).toBe('persistent')
        })

        it('system:compact_boundary → persistent', () => {
            expect(classifyMessage('system', 'compact_boundary')).toBe('persistent')
        })

        it('system:microcompact_boundary → persistent', () => {
            expect(classifyMessage('system', 'microcompact_boundary')).toBe('persistent')
        })

        it('system:api_error → persistent', () => {
            expect(classifyMessage('system', 'api_error')).toBe('persistent')
        })

        it('system:api_retry → persistent', () => {
            expect(classifyMessage('system', 'api_retry')).toBe('persistent')
        })

        it('system:turn_duration → persistent', () => {
            expect(classifyMessage('system', 'turn_duration')).toBe('persistent')
        })

        it('system:local_command_output → persistent', () => {
            expect(classifyMessage('system', 'local_command_output')).toBe('persistent')
        })

        it('未知 type → persistent', () => {
            expect(classifyMessage('unknown_type')).toBe('persistent')
        })

        it('未知 subtype → persistent', () => {
            expect(classifyMessage('system', 'unknown_subtype')).toBe('persistent')
        })

        it('null subtype → persistent', () => {
            expect(classifyMessage('system', null)).toBe('persistent')
        })

        it('undefined subtype → persistent', () => {
            expect(classifyMessage('system')).toBe('persistent')
        })

        it('空字符串 type → persistent', () => {
            expect(classifyMessage('')).toBe('persistent')
        })
    })

    describe('匹配优先级', () => {
        it('discard 优先于 ephemeral', () => {
            expect(classifyMessage('system', 'hook_started')).toBe('discard')
        })
    })
})

// ========== 读路径：web 聊天流可见性 ==========

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

    it('command_lifecycle 返回 false（控制帧，历史落库行静默跳过）', () => {
        // SDK 0.3.206 新增的排队生命周期回执，早期版本曾被当 persistent 落库；
        // 现由 classifyMessage discard 拦截新消息，此处兜底过滤历史行（web 端不再 console.warn）
        expect(isClaudeChatVisibleMessage({ type: 'command_lifecycle' })).toBe(false)
    })
})
