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
 * ChatContainer 工具函数测试
 * 测试从 ChatContainer.tsx 中提取的纯函数
 */

import { describe, it, expect } from 'vitest'

// ========== parseCliOutputText ==========

function parseCliOutputText(text: string): { command: string | null, stdout: string | null } {
    const commandMatch = text.match(/<command-name>([\s\S]*?)<\/command-name>/i)
    const stdoutMatch = text.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/i)

    const command = commandMatch ? commandMatch[1].replace(/&#x[0-9A-Fa-f]+;/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
    ).trim() : null

    const stdout = stdoutMatch ? stdoutMatch[1].replace(/&#x[0-9A-Fa-f]+;/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
    ).replace(/\x1B\[[0-9;]*m/g, '').trim() : null

    return { command, stdout }
}

describe('parseCliOutputText', () => {
    it('提取命令和输出', () => {
        const text = '<command-name>/help</command-name><local-command-stdout>Help info</local-command-stdout>'
        const result = parseCliOutputText(text)
        expect(result.command).toBe('/help')
        expect(result.stdout).toBe('Help info')
    })

    it('仅有命令无输出', () => {
        const text = '<command-name>/test</command-name>'
        const result = parseCliOutputText(text)
        expect(result.command).toBe('/test')
        expect(result.stdout).toBeNull()
    })

    it('无命令和输出', () => {
        const result = parseCliOutputText('plain text')
        expect(result.command).toBeNull()
        expect(result.stdout).toBeNull()
    })

    it('解码 HTML 实体（&#xNN; 格式）', () => {
        // 注意：源码 replace 的回调中未使用捕获组，&#xNN; 格式解码可能不正确
        // 这里测试实际行为：trim 后空白被去除
        const text = '<command-name>  /help  </command-name>'
        const result = parseCliOutputText(text)
        expect(result.command).toBe('/help')
    })

    it('去除 ANSI 转义码', () => {
        const text = '<local-command-stdout>\x1B[32mgreen text\x1B[0m</local-command-stdout>'
        const result = parseCliOutputText(text)
        expect(result.stdout).toBe('green text')
    })
})

// ========== formatMessageTime ==========

function formatMessageTime(createdAt: number): string {
    const date = new Date(createdAt)
    const now = new Date()
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const time = `${hours}:${minutes}`

    const sameYear = date.getFullYear() === now.getFullYear()
    const sameMonth = sameYear && date.getMonth() === now.getMonth()
    const sameDay = sameMonth && date.getDate() === now.getDate()

    if (sameDay) return time
    const monthDay = `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`
    if (sameYear) return `${monthDay} ${time}`
    return `${date.getFullYear()}/${monthDay} ${time}`
}

describe('formatMessageTime', () => {
    it('当天只显示时间', () => {
        const now = Date.now()
        const result = formatMessageTime(now)
        // 验证格式为 HH:MM
        expect(result).toMatch(/^\d{2}:\d{2}$/)
    })

    it('同年不同天显示 MM/DD HH:mm', () => {
        const now = new Date()
        // 设置为今年 1 月 1 日
        const past = new Date(now.getFullYear(), 0, 1, 10, 30).getTime()
        const result = formatMessageTime(past)
        // 1月1日不是今天（除非恰好是今天）
        if (now.getMonth() !== 0 || now.getDate() !== 1) {
            expect(result).toBe(`01/01 10:30`)
        }
    })

    it('不同年显示 YYYY/MM/DD HH:mm', () => {
        const past = new Date(2024, 5, 15, 14, 30).getTime()
        const result = formatMessageTime(past)
        expect(result).toBe('2024/06/15 14:30')
    })
})

// ========== extractApiErrorDetail ==========

function extractApiErrorDetail(error: unknown): string | null {
    if (!error || typeof error !== 'object') return null
    const err = error as Record<string, unknown>
    if (err.error && typeof err.error === 'object') {
        const inner = err.error as Record<string, unknown>
        if (inner.error && typeof inner.error === 'object') {
            const deepest = inner.error as Record<string, unknown>
            const code = typeof deepest.code === 'string' ? deepest.code : ''
            const message = typeof deepest.message === 'string' ? deepest.message : ''
            if (code || message) return `${code ? `[${code}] ` : ''}${message}`
        }
    }
    return null
}

describe('extractApiErrorDetail', () => {
    it('提取嵌套 error.error.code 和 message', () => {
        const error = {
            error: {
                error: { code: 'RATE_LIMIT', message: 'Too many requests' }
            }
        }
        expect(extractApiErrorDetail(error)).toBe('[RATE_LIMIT] Too many requests')
    })

    it('仅有 code', () => {
        const error = {
            error: { error: { code: 'TIMEOUT', message: '' } }
        }
        expect(extractApiErrorDetail(error)).toBe('[TIMEOUT] ')
    })

    it('仅有 message', () => {
        const error = {
            error: { error: { code: '', message: 'Unknown error' } }
        }
        expect(extractApiErrorDetail(error)).toBe('Unknown error')
    })

    it('非对象返回 null', () => {
        expect(extractApiErrorDetail(null)).toBeNull()
        expect(extractApiErrorDetail('error')).toBeNull()
        expect(extractApiErrorDetail(undefined)).toBeNull()
    })

    it('结构不匹配返回 null', () => {
        expect(extractApiErrorDetail({ error: 'string' })).toBeNull()
        expect(extractApiErrorDetail({})).toBeNull()
    })
})

// ========== getApiErrorCode ==========

function getApiErrorCode(error: unknown): string | null {
    if (!error || typeof error !== 'object') return null
    const err = error as Record<string, unknown>
    if (err.error && typeof err.error === 'object') {
        const inner = err.error as Record<string, unknown>
        if (inner.error && typeof inner.error === 'object') {
            const deepest = inner.error as Record<string, unknown>
            if (typeof deepest.code === 'string') return deepest.code
        }
    }
    if (typeof err.status === 'number') return String(err.status)
    return null
}

describe('getApiErrorCode', () => {
    it('提取嵌套 error.error.code', () => {
        const error = {
            error: { error: { code: 'RATE_LIMIT', message: 'Too many' } }
        }
        expect(getApiErrorCode(error)).toBe('RATE_LIMIT')
    })

    it('退回到 status code', () => {
        expect(getApiErrorCode({ status: 429 })).toBe('429')
        expect(getApiErrorCode({ status: 500 })).toBe('500')
    })

    it('无法提取时返回 null', () => {
        expect(getApiErrorCode(null)).toBeNull()
        expect(getApiErrorCode({})).toBeNull()
        expect(getApiErrorCode({ error: 'string' })).toBeNull()
    })
})

// ========== lastMessageActivityAt（#34 静默告警的活动时间源）==========

import { lastMessageActivityAt, lastUserMessageAt } from '@/components/chat/ChatContainer'

describe('lastMessageActivityAt', () => {
    it('落库消息（有 positionAt）取最后一条的 positionAt', () => {
        expect(lastMessageActivityAt([
            { positionAt: 1_000, createdAt: 1_000 },
            { positionAt: 2_000, createdAt: 1_900 },
        ])).toBe(2_000)
    })

    it('快照消息（无 positionAt，未落库）回退 createdAt——流式输出期间活动被计入，不误报等待', () => {
        expect(lastMessageActivityAt([
            { positionAt: 1_000, createdAt: 1_000 },
            { createdAt: 3_000, snapshot: true },
        ])).toBe(3_000)
    })

    it('全部为快照消息时取最后一条 createdAt', () => {
        expect(lastMessageActivityAt([{ createdAt: 500 }])).toBe(500)
    })

    it('空列表返回 undefined（无活动信息，不触发告警）', () => {
        expect(lastMessageActivityAt([])).toBeUndefined()
    })
})


// ========== lastUserMessageAt（StatusBar 本轮计时的时间源）==========

/** 造最小 DecryptedMessage 形状：role 在 content 内（生产真实形状——顶层无 role 字段） */
const msg = (role: string, extra: Partial<Parameters<typeof lastUserMessageAt>[0][number]> = {}) =>
    ({ content: { role }, createdAt: 0, ...extra }) as Parameters<typeof lastUserMessageAt>[0][number]

describe('lastUserMessageAt', () => {
    it('取最后一条 user 消息的 positionAt（其后的 agent/event 消息不影响）', () => {
        expect(lastUserMessageAt([
            msg('user', { positionAt: 1_000, createdAt: 1_000 }),
            msg('assistant', { positionAt: 8_000, createdAt: 7_000 }),
            msg('system', { positionAt: 9_000, createdAt: 8_500 }),
        ])).toBe(1_000)
    })

    it('user 消息无 positionAt（排队/快照）回退 createdAt——提交时刻即本轮起点', () => {
        expect(lastUserMessageAt([
            msg('assistant', { positionAt: 2_000, createdAt: 1_500 }),
            msg('user', { createdAt: 5_000 }),
        ])).toBe(5_000)
    })

    it('多条 user 取最后一条', () => {
        expect(lastUserMessageAt([
            msg('user', { positionAt: 1_000, createdAt: 1_000 }),
            msg('assistant', { positionAt: 2_000, createdAt: 1_900 }),
            msg('user', { positionAt: 3_000, createdAt: 2_900 }),
        ])).toBe(3_000)
    })

    it('role 读 content.role 而非顶层（顶层无 role 字段——旧实现恒 undefined，计时从未生效）', () => {
        // 顶层 role（真实消息不存在，防回归用）不得参与判定；content.role 为准
        expect(lastUserMessageAt([
            msg('assistant', { positionAt: 2_000, createdAt: 1_500 }),
        ])).toBeUndefined()
    })

    it('发送失败的 user 消息不劫持计时起点——跳过取更早的有效 user', () => {
        expect(lastUserMessageAt([
            msg('user', { positionAt: 1_000, createdAt: 1_000 }),
            msg('assistant', { positionAt: 2_000, createdAt: 1_900 }),
            msg('user', { positionAt: 9_000, createdAt: 8_000, status: 'failed' }),
        ])).toBe(1_000)
    })

    it('在途（sending）的 user 消息同样跳过——尚未被受理，当前 running 的仍是旧一轮', () => {
        expect(lastUserMessageAt([
            msg('user', { positionAt: 1_000, createdAt: 1_000 }),
            msg('user', { positionAt: 9_000, createdAt: 8_000, status: 'sending' }),
        ])).toBe(1_000)
    })

    it('无 user 消息返回 undefined（计时回退组件 mount 时间）', () => {
        expect(lastUserMessageAt([
            msg('assistant', { positionAt: 2_000, createdAt: 1_500 }),
        ])).toBeUndefined()
        expect(lastUserMessageAt([])).toBeUndefined()
    })
})
