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
    classifyError,
    presentError,
    deriveContextFullState,
    extractResetAt,
    extractRequestId,
    type ErrorContext,
    type ErrorInput,
} from '../src/errorPresentation'

/** 全部动作都可用的「理想」上下文，单测里按需覆写 */
const OPEN_CONTEXT: ErrorContext = {
    canRewind: true,
    canSend: true,
    sessionState: 'active',
    hasFallbackModel: true,
    hasWorkspace: true,
    turnHasAssistantOutput: false,
}

describe('classifyError', () => {
    const cases: Array<{ name: string; input: ErrorInput; expected: string; matchedBy: string }> = [
        {
            // 真实 CC 额度耗尽载荷（429 + usage limit 文本），不是瞬时限流
            name: '429 额度耗尽（真实载荷）',
            input: {
                status: 429,
                errorType: 'rate_limit_error',
                message: 'Claude AI usage limit reached. Your limit will reset at 2026-10-21T00:00:00Z.',
            },
            expected: 'quota_exhausted',
            matchedBy: 'text',
        },
        {
            // 真实网关额度耗尽（result 载荷）：中文文案 + 429 + 1310
            name: '429 额度耗尽（中文网关真实文案）',
            input: {
                status: 429,
                message: 'API Error: Request rejected (429) · [1310][您已达到每周/每月使用上限，您的限额将在 2026-10-21 10:02:11 重置。]',
            },
            expected: 'quota_exhausted',
            matchedBy: 'text',
        },
        {
            name: '429 瞬时限流',
            input: {
                status: 429,
                errorType: 'rate_limit_error',
                message: 'Number of request tokens has exceeded your per-minute rate limit.',
            },
            expected: 'rate_limit',
            matchedBy: 'status',
        },
        {
            name: '529 过载',
            input: { status: 529, message: 'Overloaded' },
            expected: 'overloaded',
            matchedBy: 'status',
        },
        {
            name: '500 服务端错误',
            input: { status: 500, message: 'Internal server error' },
            expected: 'server_error',
            matchedBy: 'status',
        },
        {
            // 真实上下文满文本
            name: '上下文满（prompt too long）',
            input: { status: 400, message: 'Prompt is too long: 210000 tokens > 200000 maximum' },
            expected: 'context_length',
            matchedBy: 'text',
        },
        {
            // 真实 api_error 载荷同时带 type=invalid_request_error——文本必须先于类型映射
            name: '上下文满（真实 api_error 载荷带 invalid_request_error）',
            input: {
                status: 400,
                errorType: 'invalid_request_error',
                message: 'Prompt is too long: 210000 tokens > 200000 maximum',
            },
            expected: 'context_length',
            matchedBy: 'text',
        },
        {
            name: '400 invalid_request_error 无具体文本 → invalid_request',
            input: { status: 400, errorType: 'invalid_request_error', message: 'Malformed request body' },
            expected: 'invalid_request',
            matchedBy: 'errorType',
        },
        {
            name: '断网标记优先于状态码',
            input: { status: 500, isNetworkDown: true, message: 'Connection error' },
            expected: 'network',
            matchedBy: 'flag',
        },
        {
            name: '401 鉴权',
            input: { status: 401, message: 'Unauthorized' },
            expected: 'auth',
            matchedBy: 'status',
        },
        {
            name: '403 组织策略',
            input: { status: 403, message: "This request is blocked by your organization's policy." },
            expected: 'org_policy_denied',
            matchedBy: 'text',
        },
        {
            name: '403 普通权限拒绝',
            input: { status: 403, message: 'You do not have permission to use this model.' },
            expected: 'permission_denied',
            matchedBy: 'status',
        },
        {
            name: '组织被封禁',
            input: { status: 400, message: "Your organization's access has been disabled." },
            expected: 'org_disabled',
            matchedBy: 'text',
        },
        {
            name: '内容策略',
            input: { status: 400, message: 'Our safeguard flagged this message under the usage policy.' },
            expected: 'usage_policy',
            matchedBy: 'text',
        },
        {
            name: '图片尺寸',
            input: { status: 400, message: 'Image is too large: 9000px exceeds 8000px limit.' },
            expected: 'image_dimension',
            matchedBy: 'text',
        },
        {
            name: '图片无法读取',
            input: { status: 400, message: 'Image could not be processed.' },
            expected: 'image_invalid',
            matchedBy: 'text',
        },
        {
            name: '413 请求过大',
            input: { status: 413, message: 'Payload too large' },
            expected: 'request_too_large',
            matchedBy: 'status',
        },
        {
            name: '模型不存在',
            input: { status: 404, message: 'unknown model: claude-nonexistent' },
            expected: 'model_not_found',
            matchedBy: 'text',
        },
        {
            // CC Switch 真实响应（400）：聚合模型不在白名单
            name: '聚合模型不存在（CC Switch 真实文案）',
            input: {
                status: 400,
                message: 'Aggregated model ccs-claude-unknown--x is unknown to CC Switch; pick a model from the model list again',
            },
            expected: 'model_not_found',
            matchedBy: 'text',
        },
        {
            // DeepSeek 真实响应（400）：模型名不在支持列表
            name: '供应商模型名不在支持列表（DeepSeek 真实文案）',
            input: {
                status: 400,
                message: 'The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed no-such-model.',
            },
            expected: 'model_not_found',
            matchedBy: 'text',
        },
        {
            // 网关余额不足：既不是限流也不是模型问题
            name: '余额不足 → billing',
            input: {
                status: 400,
                errorType: 'invalid_request_error',
                message: 'Your credit balance is too low to access the Anthropic API.',
            },
            expected: 'billing',
            matchedBy: 'text',
        },
        {
            // not_found_error 不等于模型不存在：会话/文件/路由 404 也会带它
            name: 'not_found_error 无语义文本 → unknown',
            input: { status: 404, errorType: 'not_found_error', message: 'Not found' },
            expected: 'unknown',
            matchedBy: 'none',
        },
        {
            name: '输出上限（stop reason）',
            input: { stopReason: 'max_tokens' },
            expected: 'output_token_limit',
            matchedBy: 'stopReason',
        },
        {
            name: '轮次到顶（result subtype）',
            input: { resultSubtype: 'error_max_turns' },
            expected: 'max_turns',
            matchedBy: 'resultSubtype',
        },
        {
            name: '400 未识别原因',
            input: { status: 400, message: 'Something odd happened' },
            expected: 'invalid_request',
            matchedBy: 'status',
        },
        {
            name: '无任何证据',
            input: { message: 'mystery' },
            expected: 'unknown',
            matchedBy: 'none',
        },
    ]

    for (const c of cases) {
        it(`${c.name} → ${c.expected}`, () => {
            const result = classifyError(c.input)
            expect(result.category).toBe(c.expected)
            expect(result.evidence.matchedBy).toBe(c.matchedBy)
        })
    }

    it('断网标记优先于 401', () => {
        expect(classifyError({ status: 401, isNetworkDown: true }).category).toBe('network')
    })
})

describe('presentError', () => {
    it('额度耗尽：原文直接铺在卡片里', () => {
        expect(presentError('quota_exhausted', OPEN_CONTEXT).inlineRaw).toBe(true)
    })

    it('上下文满（可回退）→ 压缩为主按钮', () => {
        const p = presentError('context_length', OPEN_CONTEXT)
        expect(p.actions).toEqual(['compact', 'rewind', 'newSession'])
        expect(p.bodyKey).toBe('chat.error.body.context_length')
        expect(p.noteKey).toBeUndefined()
        expect(p.inlineRaw).toBe(false)
        expect(p.severity).toBe('error')
    })

    it('上下文满（不可回退）→ 去掉回退并换文案变体', () => {
        const p = presentError('context_length', { ...OPEN_CONTEXT, canRewind: false })
        expect(p.actions).toEqual(['compact', 'newSession'])
        expect(p.noteKey).toBe('chat.error.note.rewindUnavailable')
    })

    it('上下文满（压缩已试过）→ tried 文案', () => {
        const p = presentError('context_length', {
            ...OPEN_CONTEXT,
            compact: { pending: false, tried: true },
        })
        expect(p.noteKey).toBe('chat.error.note.compactTried')
    })

    it('不能发消息 → 去掉重试与压缩', () => {
        const p = presentError('rate_limit', { ...OPEN_CONTEXT, canSend: false })
        expect(p.actions).toEqual(['copyDetails'])
        expect(p.noteKey).toBe('chat.error.note.composerUnavailable')
    })

    it('瞬时限流是警告级、原文转述', () => {
        const p = presentError('rate_limit', OPEN_CONTEXT)
        expect(p.severity).toBe('warning')
        expect(p.inlineRaw).toBe(false)
        expect(p.actions[0]).toBe('retry')
    })

    it('休眠会话 → 只留唤醒与详情', () => {
        const p = presentError('quota_exhausted', { ...OPEN_CONTEXT, sessionState: 'dormant' })
        expect(p.actions).toEqual(['resume', 'copyDetails'])
        expect(p.bodyKey).toBe('chat.error.body.quota_exhausted')
        expect(p.noteKey).toBeUndefined()
    })

    it('无备选模型 → 去掉切模型', () => {
        const p = presentError('model_not_found', { ...OPEN_CONTEXT, hasFallbackModel: false })
        expect(p.actions).toEqual(['newSession', 'copyDetails'])
    })

    it('无工作区 → 去掉新建会话', () => {
        const p = presentError('auth', { ...OPEN_CONTEXT, hasWorkspace: false })
        expect(p.actions).toEqual(['reauth', 'copyDetails'])
    })

    it('本轮已有助手产出 → 去掉重试（重发会重跑整轮工作）', () => {
        const p = presentError('rate_limit', { ...OPEN_CONTEXT, turnHasAssistantOutput: true })
        expect(p.actions).not.toContain('retry')
        expect(p.actions).toContain('copyDetails')
    })

    it('轮次到顶：原文仅进详情，不给重复上一轮的重试', () => {
        const p = presentError('max_turns', OPEN_CONTEXT)
        expect(p.inlineRaw).toBe(false)
        expect(p.actions).not.toContain('retry')
        expect(p.actions).toContain('copyDetails')
    })
})

describe('deriveContextFullState', () => {
    it('无后续事件 → 全 false', () => {
        const state = deriveContextFullState([{ type: 'error' }], 0)
        expect(state).toEqual({ pending: false, tried: false, spent: false })
    })

    it('压缩进行中 → pending', () => {
        const state = deriveContextFullState([{ type: 'error' }, { type: 'compact-started' }], 0)
        expect(state).toEqual({ pending: true, tried: false, spent: false })
    })

    it('压缩完成后又满 → spent + tried', () => {
        const state = deriveContextFullState(
            [{ type: 'error' }, { type: 'compact-started' }, { type: 'compact' }, { type: 'error' }],
            0,
        )
        expect(state).toEqual({ pending: false, tried: true, spent: true })
    })

    it('压缩完成后未再满 → spent only', () => {
        const state = deriveContextFullState(
            [{ type: 'error' }, { type: 'compact-started' }, { type: 'compact' }],
            0,
        )
        expect(state).toEqual({ pending: false, tried: false, spent: true })
    })

    it('turn-end 之后的事件不计入（下一轮的压缩不改写历史卡片）', () => {
        const state = deriveContextFullState(
            [{ type: 'error' }, { type: 'turn-end' }, { type: 'compact-started' }],
            0,
        )
        expect(state).toEqual({ pending: false, tried: false, spent: false })
    })

    it('锚点之前的事件不计入', () => {
        const state = deriveContextFullState(
            [{ type: 'compact' }, { type: 'error' }, { type: 'error' }],
            1,
        )
        expect(state).toEqual({ pending: false, tried: false, spent: false })
    })
})

describe('extractResetAt', () => {
    it('命中 ISO 时间 + 重置语义', () => {
        expect(
            extractResetAt('Claude AI usage limit reached. Your limit will reset at 2026-10-21T00:00:00Z.'),
        ).toBe('2026-10-21T00:00:00Z')
    })

    it('中文重置语义同样命中', () => {
        expect(extractResetAt('额度已用完，将于 2026-10-21T08:00:00Z 重置。')).toBe('2026-10-21T08:00:00Z')
    })

    it('CC 网关的本地时间格式（无时区）', () => {
        const message =
            'API Error: Request rejected (429) · [1310][您已达到每周/每月使用上限，您的限额将在 2026-10-21 10:02:11 重置。][2026102022313069bf1b0a3ae240cc]'
        expect(extractResetAt(message)).toBe('2026-10-21T10:02:11')
    })

    it('无时间戳 → null', () => {
        expect(extractResetAt('usage limit reached, try later')).toBeNull()
    })

    it('有 ISO 时间但无重置语义 → 不误判', () => {
        expect(extractResetAt('Request failed at 2026-10-21T00:00:00Z with status 500')).toBeNull()
    })

    it('空文本 → null', () => {
        expect(extractResetAt(null)).toBeNull()
    })
})

describe('extractRequestId', () => {
    it('命中 req_ 前缀 ID', () => {
        expect(extractRequestId('Error (request id: req_011CUxAbCdEf123456)')).toBe('req_011CUxAbCdEf123456')
    })

    it('无 ID → null', () => {
        expect(extractRequestId('plain error')).toBeNull()
        expect(extractRequestId(undefined)).toBeNull()
    })
})
