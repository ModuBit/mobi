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

import { isObject } from '@mobi/shared'

export type AskUserQuestionOption = {
    label: string
    description: string | null
    preview: string | null
}

/** AskUserQuestion / RequestUserInput 的 answers 格式 */
export type AnswersFormat = Record<string, string | string[]> | Record<string, { answers: string[] }>

/** 将单条 answer entry 标准化为 string[] */
export function normalizeAnswerEntry(entry: string | string[] | { answers: string[] }): string[] {
    if (typeof entry === 'string') {
        return [entry]
    }
    if (Array.isArray(entry)) {
        return entry
    }
    return entry.answers ?? []
}

/** 将整个 answers 对象标准化为扁平格式: Record<string, string[]> */
export function normalizeAnswers(answers: AnswersFormat | undefined): Record<string, string[]> | undefined {
    if (!answers) return undefined
    const result: Record<string, string[]> = {}
    for (const [key, value] of Object.entries(answers)) {
        result[key] = normalizeAnswerEntry(value as string | string[] | { answers: string[] })
    }
    return result
}

export type AskUserQuestionQuestion = {
    header: string | null
    question: string
    options: AskUserQuestionOption[]
    multiSelect: boolean
}

export type AskUserQuestionQuestionInfo = {
    header: string | null
    question: string | null
}

export function isAskUserQuestionToolName(toolName: string): boolean {
    return toolName === 'AskUserQuestion' || toolName === 'ask_user_question'
}

export function parseAskUserQuestionInput(input: unknown): { questions: AskUserQuestionQuestion[] } {
    if (!isObject(input)) return { questions: [] }

    const rawQuestions = input.questions
    if (!Array.isArray(rawQuestions)) return { questions: [] }

    const questions: AskUserQuestionQuestion[] = []
    for (const raw of rawQuestions) {
        if (!isObject(raw)) continue

        const question = typeof raw.question === 'string' ? raw.question.trim() : ''
        const header = typeof raw.header === 'string' ? raw.header.trim() : ''
        const multiSelect = typeof raw.multiSelect === 'boolean' ? raw.multiSelect : false

        const rawOptions = Array.isArray(raw.options) ? raw.options : []
        const options: AskUserQuestionOption[] = []
        for (const opt of rawOptions) {
            if (!isObject(opt)) continue
            const label = typeof opt.label === 'string' ? opt.label.trim() : ''
            if (!label) continue
            const description = typeof opt.description === 'string' ? opt.description.trim() : null
            const preview = typeof opt.preview === 'string' ? opt.preview.trim() : null
            options.push({ label, description, preview })
        }

        if (!question && options.length === 0) continue

        questions.push({
            header: header.length > 0 ? header : null,
            question,
            options,
            multiSelect
        })
    }

    return { questions }
}

/** 从 questions 中提取 header/question 字段并用 ' / ' 连接，无有效值时返回 null */
export function joinQuestionHeaders(input: unknown, field: 'header' | 'question' = 'header'): string | null {
    const parsed = parseAskUserQuestionInput(input)
    const headers = parsed.questions
        .map(q => field === 'header' ? q.header : q.question)
        .filter((h): h is string => h !== null && h.length > 0)
    if (headers.length === 0) return null
    return headers.join(' / ')
}

/** 从 result 文本中解析 "question"="answer" 对 */
export function parseAnswersFromResultText(text: string | null): Record<string, string[]> | null {
    if (!text) return null
    const answers: Record<string, string[]> = {}
    for (const match of text.matchAll(/"([^"]+)"="([^"]+)"/g)) {
        answers[match[1]] = [match[2]]
    }
    return Object.keys(answers).length > 0 ? answers : null
}

export function extractAskUserQuestionQuestionsInfo(input: unknown): AskUserQuestionQuestionInfo[] | null {
    if (!isObject(input)) return null
    const raw = input.questions
    if (!Array.isArray(raw)) return null

    const questions: AskUserQuestionQuestionInfo[] = []
    for (const q of raw) {
        if (!isObject(q)) continue
        const header = typeof q.header === 'string' ? q.header.trim() : null
        const question = typeof q.question === 'string' ? q.question.trim() : null
        questions.push({
            header: header && header.length > 0 ? header : null,
            question: question && question.length > 0 ? question : null
        })
    }
    return questions
}

/**
 * 构造「聊一聊」seed 文案（对齐 Claude Code CLI 的 Chat about this）。
 * 用户不答题、想就问题与 Claude 展开讨论时，作为 deny reason 回传，
 * 引导 Claude 主动反问"想澄清什么"，而非给出 dead-end "No answers were provided."。
 *
 * @param questions 问题列表（可空，空时退化为占位）
 * @param answers   用户触发前已选答案 Record<questionText, string[]>（可空）
 */
export function buildChatAboutThisReason(
    questions: AskUserQuestionQuestion[],
    answers: Record<string, string[]>
): string {
    const items = questions.length > 0
        ? questions
        : [{ header: null, question: '(no question)', options: [], multiSelect: false } as AskUserQuestionQuestion]

    const lines = items.map(q => {
        const selected = (answers[q.question] ?? [])
            .map(a => a.trim())
            .filter(a => a.length > 0)
        const answerLine = selected.length > 0
            ? `  Answer: ${selected.join(', ')}`
            : `  (No answer provided)`
        return `- "${q.question}"\n${answerLine}`
    }).join('\n')

    return [
        'The user wants to clarify these questions.',
        '    This means they may have additional information, context or questions for you.',
        '    Take their response into account and then reformulate the questions if appropriate.',
        '    Start by asking them what they would like to clarify.',
        '',
        '    Questions asked:',
        lines,
    ].join('\n')
}
