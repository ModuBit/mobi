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

// runClaude 用户消息消费段行为锁定（P4：runClaude 消费端接线 + attachmentFormatter 退役）：
// 1. UserMessageSchema 门口放行 hub 新格式信封（content = block 数组）且不丢旧平铺 attachments
// 2. resolveUserMessageContent 四形态归一 → 纯文本退化为 string（与旧 formatMessageWithAttachments 逐字节一致）
// 3. 含 image block → content 数组且 base64 正确
// handler 本体依赖 apiSession/messageQueue 过重，此处测其抽出的纯函数与 schema 门口
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('@/ui/logger', () => ({
    logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

// vi.mock 之上再导入被测模块（vitest 会把 vi.mock 提升到文件顶部）
import { resolveUserMessageContent } from '@/claude/runClaude'
import { UserMessageSchema } from '@/api/types'

let dir: string
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'runclaude-blocks-'))
    writeFileSync(join(dir, 'pic.png'), pngBytes)
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('UserMessageSchema 门口（apiSession.handleIncomingMessage 的用户消息分流）', () => {
    it('hub 新格式信封（content = block 数组）放行', () => {
        const envelope = { role: 'user', content: [{ type: 'text', text: 'hi' }], meta: { sentFrom: 'webapp' } }
        const r = UserMessageSchema.safeParse(envelope)
        expect(r.success).toBe(true)
        if (r.success) expect(r.data.content).toEqual([{ type: 'text', text: 'hi' }])
    })

    it('旧平铺信封放行且 attachments 不被剥掉（union 顺序回归）', () => {
        const envelope = {
            role: 'user',
            content: {
                type: 'text', text: 'old',
                attachments: [{ id: '1', filename: 'a.png', mimeType: 'image/png', size: 3, path: '/p/a.png' }],
            },
        }
        const r = UserMessageSchema.safeParse(envelope)
        expect(r.success).toBe(true)
        if (r.success) {
            const content = r.data.content as { attachments?: unknown[] }
            expect(content.attachments).toHaveLength(1)
        }
    })

    it('agent 信封与畸形 content 不放行（走 emit message 通道 / 丢弃）', () => {
        expect(UserMessageSchema.safeParse({ role: 'agent', content: { type: 'output', data: 1 } }).success).toBe(false)
        expect(UserMessageSchema.safeParse({ role: 'user', content: 123 }).success).toBe(false)
    })
})

describe('resolveUserMessageContent（onUserMessage 消费段纯函数）', () => {
    it('纯文本（string / block 数组两入口）→ string 形态，与旧格式一致', () => {
        expect(resolveUserMessageContent('你好')).toMatchObject({ formattedPrompt: '你好', commandSourceText: '你好' })
        expect(resolveUserMessageContent([{ type: 'text', text: '你好' }])).toMatchObject({
            formattedPrompt: '你好',
            commandSourceText: '你好',
        })
    })

    it('旧平铺（text + attachments）→ 与旧 formatMessageWithAttachments 逐字节一致', () => {
        const r = resolveUserMessageContent({
            type: 'text', text: '正文',
            attachments: [
                { id: '1', filename: 'a.png', mimeType: 'image/png', size: 3, path: '/p/a.png' },
                { id: '2', filename: 'b.pdf', mimeType: 'application/pdf', size: 4, path: '/p/b.pdf' },
            ],
        })
        // 旧实现：`${attachments.map(@path).join(' ')}\n\n${text}`
        expect(r?.formattedPrompt).toBe('@/p/a.png @/p/b.pdf\n\n正文')
        expect(r?.commandSourceText).toBe('正文')
    })

    it('text + image（tmpdir 真实 png）→ content 数组且 base64 正确', () => {
        const r = resolveUserMessageContent([
            { type: 'text', text: '看图' },
            {
                type: 'image', source: { type: 'url', value: join(dir, 'pic.png'), mimeType: 'image/png' },
                id: 'i1', filename: 'pic.png', size: pngBytes.length,
            },
        ])
        expect(r?.formattedPrompt).toEqual([
            { type: 'text', text: '看图' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: pngBytes.toString('base64') } },
        ])
    })

    it('commandSourceText 取首个 text block（命令检测源文本）', () => {
        const r = resolveUserMessageContent([
            { type: 'document', source: { type: 'url', value: '/a.pdf', mimeType: 'application/pdf' }, id: 'd', filename: 'a.pdf', size: 1 },
            { type: 'text', text: '/compact' },
            { type: 'text', text: '尾巴' },
        ])
        expect(r?.commandSourceText).toBe('/compact')
    })

    it('无法归一（空串 / 空数组 / 全畸形 / null）→ null（handler 跳过本条）', () => {
        expect(resolveUserMessageContent('')).toBeNull()
        expect(resolveUserMessageContent([])).toBeNull()
        expect(resolveUserMessageContent([{ type: 'unknown' }])).toBeNull()
        expect(resolveUserMessageContent(null)).toBeNull()
    })
})
