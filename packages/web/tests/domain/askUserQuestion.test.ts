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

import { describe, expect, it } from 'vitest'
import {
    isAskUserQuestionToolName,
    parseAskUserQuestionInput,
    normalizeAnswerEntry,
    normalizeAnswers,
    extractAskUserQuestionQuestionsInfo,
    buildChatAboutThisReason,
} from '@/domain/tool/askUserQuestion'
import type { AskUserQuestionQuestion } from '@/domain/tool/askUserQuestion'

describe('isAskUserQuestionToolName', () => {
    it('matches AskUserQuestion', () => {
        expect(isAskUserQuestionToolName('AskUserQuestion')).toBe(true)
    })

    it('matches ask_user_question', () => {
        expect(isAskUserQuestionToolName('ask_user_question')).toBe(true)
    })

    it('rejects other tool names', () => {
        expect(isAskUserQuestionToolName('Bash')).toBe(false)
        expect(isAskUserQuestionToolName('RequestUserInput')).toBe(false)
    })
})

describe('parseAskUserQuestionInput', () => {
    it('returns empty for non-object input', () => {
        expect(parseAskUserQuestionInput(null)).toEqual({ questions: [] })
        expect(parseAskUserQuestionInput('string')).toEqual({ questions: [] })
        expect(parseAskUserQuestionInput(123)).toEqual({ questions: [] })
    })

    it('returns empty when questions is not an array', () => {
        expect(parseAskUserQuestionInput({ questions: 'not-array' })).toEqual({ questions: [] })
    })

    it('parses a single question with options', () => {
        const result = parseAskUserQuestionInput({
            questions: [{
                question: 'Which runtime?',
                header: 'Runtime',
                options: [
                    { label: 'Bun', description: 'Fast runtime' },
                    { label: 'Node', description: 'Classic runtime' },
                ],
                multiSelect: false,
            }],
        })

        expect(result.questions).toHaveLength(1)
        expect(result.questions[0]).toEqual({
            header: 'Runtime',
            question: 'Which runtime?',
            options: [
                { label: 'Bun', description: 'Fast runtime', preview: null },
                { label: 'Node', description: 'Classic runtime', preview: null },
            ],
            multiSelect: false,
        })
    })

    it('parses options with preview field', () => {
        const result = parseAskUserQuestionInput({
            questions: [{
                question: 'Choose layout',
                header: 'Layout',
                options: [
                    { label: 'Compact', description: 'Small', preview: '<div style="padding:12px">Compact</div>' },
                    { label: 'Wide', description: 'Large', preview: '```\nWide layout\n```' },
                    { label: 'No preview', description: 'Plain' },
                ],
                multiSelect: false,
            }],
        })

        expect(result.questions[0].options).toEqual([
            { label: 'Compact', description: 'Small', preview: '<div style="padding:12px">Compact</div>' },
            { label: 'Wide', description: 'Large', preview: '```\nWide layout\n```' },
            { label: 'No preview', description: 'Plain', preview: null },
        ])
    })

    it('trims preview whitespace', () => {
        const result = parseAskUserQuestionInput({
            questions: [{
                question: 'Q?',
                options: [{ label: 'A', preview: '  <div>hello</div>  ' }],
            }],
        })
        expect(result.questions[0].options[0].preview).toBe('<div>hello</div>')
    })

    it('ignores non-string preview values', () => {
        const result = parseAskUserQuestionInput({
            questions: [{
                question: 'Q?',
                options: [
                    { label: 'A', preview: 123 },
                    { label: 'B', preview: null },
                    { label: 'C', preview: undefined },
                ],
            }],
        })
        expect(result.questions[0].options.map(o => o.preview)).toEqual([null, null, null])
    })

    it('parses multi-select question', () => {
        const result = parseAskUserQuestionInput({
            questions: [{
                question: 'Select features',
                options: [
                    { label: 'Auth' },
                    { label: 'Logging' },
                ],
                multiSelect: true,
            }],
        })
        expect(result.questions[0].multiSelect).toBe(true)
    })

    it('defaults multiSelect to false', () => {
        const result = parseAskUserQuestionInput({
            questions: [{
                question: 'Q?',
                options: [{ label: 'A' }],
            }],
        })
        expect(result.questions[0].multiSelect).toBe(false)
    })

    it('skips options without label', () => {
        const result = parseAskUserQuestionInput({
            questions: [{
                question: 'Q?',
                options: [
                    { label: '', description: 'empty' },
                    { label: 'Valid' },
                    { description: 'no label' },
                ],
            }],
        })
        expect(result.questions[0].options).toHaveLength(1)
        expect(result.questions[0].options[0].label).toBe('Valid')
    })

    it('skips questions without question text and options', () => {
        const result = parseAskUserQuestionInput({
            questions: [
                { options: [] },
                { question: 'Valid?', options: [{ label: 'A' }] },
            ],
        })
        expect(result.questions).toHaveLength(1)
        expect(result.questions[0].question).toBe('Valid?')
    })

    it('converts empty header to null', () => {
        const result = parseAskUserQuestionInput({
            questions: [{
                question: 'Q?',
                header: '   ',
                options: [{ label: 'A' }],
            }],
        })
        expect(result.questions[0].header).toBeNull()
    })

    it('skips non-object questions entries', () => {
        const result = parseAskUserQuestionInput({
            questions: ['not-object', null, { question: 'Q?', options: [{ label: 'A' }] }],
        })
        expect(result.questions).toHaveLength(1)
    })

    it('skips non-object option entries', () => {
        const result = parseAskUserQuestionInput({
            questions: [{
                question: 'Q?',
                options: ['string', 42, null, { label: 'Valid' }],
            }],
        })
        expect(result.questions[0].options).toHaveLength(1)
    })
})

describe('normalizeAnswerEntry', () => {
    it('converts string to single-element array', () => {
        expect(normalizeAnswerEntry('hello')).toEqual(['hello'])
    })

    it('passes through array', () => {
        expect(normalizeAnswerEntry(['a', 'b'])).toEqual(['a', 'b'])
    })

    it('extracts answers from nested object', () => {
        expect(normalizeAnswerEntry({ answers: ['x', 'y'] })).toEqual(['x', 'y'])
    })

    it('returns empty array for nested object without answers', () => {
        expect(normalizeAnswerEntry({ answers: undefined } as any)).toEqual([])
    })
})

describe('normalizeAnswers', () => {
    it('returns undefined for undefined input', () => {
        expect(normalizeAnswers(undefined)).toBeUndefined()
    })

    it('normalizes flat string answers', () => {
        expect(normalizeAnswers({ 'Q1': 'A1', 'Q2': ['A2', 'A3'] })).toEqual({
            Q1: ['A1'],
            Q2: ['A2', 'A3'],
        })
    })

    it('normalizes nested object answers', () => {
        expect(normalizeAnswers({ 'Q1': { answers: ['A1'] } })).toEqual({
            Q1: ['A1'],
        })
    })
})

describe('extractAskUserQuestionQuestionsInfo', () => {
    it('returns null for non-object input', () => {
        expect(extractAskUserQuestionQuestionsInfo(null)).toBeNull()
        expect(extractAskUserQuestionQuestionsInfo('string')).toBeNull()
    })

    it('returns null when questions is not an array', () => {
        expect(extractAskUserQuestionQuestionsInfo({ questions: 'no' })).toBeNull()
    })

    it('extracts header and question info', () => {
        const result = extractAskUserQuestionQuestionsInfo({
            questions: [
                { header: 'Runtime', question: 'Which runtime?' },
                { question: 'No header' },
            ],
        })
        expect(result).toEqual([
            { header: 'Runtime', question: 'Which runtime?' },
            { header: null, question: 'No header' },
        ])
    })

    it('converts empty strings to null', () => {
        const result = extractAskUserQuestionQuestionsInfo({
            questions: [{ header: '   ', question: '   ' }],
        })
        expect(result).toEqual([{ header: null, question: null }])
    })
})

describe('buildChatAboutThisReason', () => {
    it('多问题 + 部分已选答案，按 CLI 原文拼装', () => {
        const questions: AskUserQuestionQuestion[] = [
            { header: 'Auth', question: 'Which library?', options: [{ label: 'JWT', description: null, preview: null }, { label: 'OAuth', description: null, preview: null }], multiSelect: false },
            { header: 'Layer', question: 'Where to store?', options: [{ label: 'Cookie', description: null, preview: null }], multiSelect: false },
        ]
        const answers: Record<string, string[]> = { 'Which library?': ['JWT'] }
        const out = buildChatAboutThisReason(questions, answers)
        expect(out).toContain('The user wants to clarify these questions.')
        expect(out).toContain('Start by asking them what they would like to clarify.')
        expect(out).toContain('- "Which library?"')
        expect(out).toContain('  Answer: JWT')
        expect(out).toContain('- "Where to store?"')
        expect(out).toContain('  (No answer provided)')
    })

    it('空 questions 退化为占位单问题', () => {
        const out = buildChatAboutThisReason([], {})
        expect(out).toContain('Questions asked:')
        expect(out).toContain('- "(no question)"')
        expect(out).toContain('(No answer provided)')
    })

    it('空 questions + fallback 文本（footer 用 "" key）→ seed 含 Answer', () => {
        // footer 在 questions 为空时把 fallback 文本存到 answers['']，
        // buildChatAboutThisReason 必须查 '' key 而非 '(no question)'，否则丢失用户输入
        const out = buildChatAboutThisReason([], { '': ['我想用 Redis 做会话'] })
        expect(out).toContain('- "(no question)"')
        expect(out).toContain('Answer: 我想用 Redis 做会话')
        expect(out).not.toContain('(No answer provided)')
    })

    it('无已选答案全部标 (No answer provided)', () => {
        const questions: AskUserQuestionQuestion[] = [
            { header: null, question: 'Q1?', options: [], multiSelect: false },
        ]
        const out = buildChatAboutThisReason(questions, {})
        expect(out).toContain('  (No answer provided)')
        expect(out).not.toContain('  Answer:')
    })
})
