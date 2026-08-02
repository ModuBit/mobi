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

import { describe, it, expect, beforeEach } from 'vitest'
import { usePromptSuggestionStore, extractPromptSuggestion } from '@/core/data/stores/promptSuggestionStore'

describe('promptSuggestionStore', () => {
    beforeEach(() => {
        usePromptSuggestionStore.setState({ bySession: new Map() })
    })

    it('setSuggestion 写入指定 session', () => {
        usePromptSuggestionStore.getState().setSuggestion('s1', '建议 A')
        expect(usePromptSuggestionStore.getState().bySession.get('s1')).toBe('建议 A')
    })

    it('setSuggestion 覆盖同 session 旧值(新建议覆盖旧建议)', () => {
        usePromptSuggestionStore.getState().setSuggestion('s1', '建议 A')
        usePromptSuggestionStore.getState().setSuggestion('s1', '建议 B')
        expect(usePromptSuggestionStore.getState().bySession.get('s1')).toBe('建议 B')
    })

    it('setSuggestion 不影响其他 session', () => {
        usePromptSuggestionStore.getState().setSuggestion('s1', '建议 A')
        usePromptSuggestionStore.getState().setSuggestion('s2', '建议 B')
        expect(usePromptSuggestionStore.getState().bySession.get('s1')).toBe('建议 A')
        expect(usePromptSuggestionStore.getState().bySession.get('s2')).toBe('建议 B')
    })

    it('clearSession 清空指定 session', () => {
        usePromptSuggestionStore.getState().setSuggestion('s1', '建议 A')
        usePromptSuggestionStore.getState().clearSession('s1')
        expect(usePromptSuggestionStore.getState().bySession.has('s1')).toBe(false)
    })
})

describe('extractPromptSuggestion', () => {
    it('提取 prompt_suggestion 消息的 suggestion 文本', () => {
        const content = {
            role: 'agent',
            content: { type: 'output', data: { type: 'prompt_suggestion', suggestion: '用 virtuoso 重构' } },
            meta: { sentFrom: 'cli' },
        }
        expect(extractPromptSuggestion(content)).toBe('用 virtuoso 重构')
    })

    it('非 prompt_suggestion 消息返回 null', () => {
        const content = {
            role: 'agent',
            content: { type: 'output', data: { type: 'assistant', message: {} } },
            meta: { sentFrom: 'cli' },
        }
        expect(extractPromptSuggestion(content)).toBeNull()
    })

    it('suggestion 为空字符串返回 null', () => {
        const content = {
            role: 'agent',
            content: { type: 'output', data: { type: 'prompt_suggestion', suggestion: '' } },
            meta: { sentFrom: 'cli' },
        }
        expect(extractPromptSuggestion(content)).toBeNull()
    })

    it('非对象内容返回 null', () => {
        expect(extractPromptSuggestion('just a string')).toBeNull()
    })
})
