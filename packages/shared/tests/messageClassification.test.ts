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
import { classifyMessage } from '../src/messageClassification'

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
