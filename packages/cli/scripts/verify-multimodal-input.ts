/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * SDK streaming input 多模态透传实证（spec「实现风险点」Task 12）：
 * 经 query() 流式输入推一条 content 为数组（含 base64 image block）的 user 消息，
 * 断言模型回复描述了图像内容——证明 Claude Code 内核对多模态 user input 完整透传。
 *
 * 运行：cd packages/cli && bun x tsx scripts/verify-multimodal-input.ts
 *      （或 bun scripts/verify-multimodal-input.ts）
 */
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { deflateSync } from 'node:zlib'

/** CRC32 表驱动实现 */
function crc32(buf: Buffer): number {
    let table = crc32Table
    if (!table) {
        table = crc32Table = new Int32Array(256)
        for (let n = 0; n < 256; n++) {
            let c = n
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
            table[n] = c
        }
    }
    let crc = -1
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
    return (crc ^ -1) >>> 0
}
let crc32Table: Int32Array | null = null

/** 构造 w×h 纯色 RGB PNG（一眼可辨的颜色，回答可判定） */
function buildSolidPng(r: number, g: number, b: number, size = 8): Buffer {
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(size, 0)
    ihdr.writeUInt32BE(size, 4)
    ihdr.set([8, 2, 0, 0, 0], 8) // 8-bit RGB
    const raw = Buffer.concat(
        Array.from({ length: size }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3).fill(Buffer.from([r, g, b]))])),
    )
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const chunk = (type: string, data: Buffer): Buffer => {
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
        const len = Buffer.alloc(4)
        len.writeUInt32BE(data.length)
        const crcBuf = Buffer.alloc(4)
        crcBuf.writeUInt32BE(crc32(body), 0)
        return Buffer.concat([len, body, crcBuf])
    }
    return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const RED_PIXEL_PNG_BASE64 = buildSolidPng(0xff, 0, 0).toString('base64')

async function* buildPrompt() {
    yield {
        type: 'user' as const,
        message: {
            role: 'user' as const,
            content: [
                {
                    type: 'text',
                    text: '图中的主色是什么？只回答一个颜色单词，不要标点。',
                },
                {
                    type: 'image',
                    source: { type: 'base64', media_type: 'image/png', data: RED_PIXEL_PNG_BASE64 },
                },
            ] as unknown as string,
        },
        parent_tool_use_id: null,
        session_id: '',
        uuid: crypto.randomUUID(),
    }
}

async function main(): Promise<void> {
    console.log('[verify-multimodal] 启动 SDK query…')
    const q = query({
        prompt: buildPrompt(),
        options: {
            maxTurns: 1,
            permissionMode: 'bypassPermissions',
            // 隔离运行：不加载项目 CLAUDE.md/hooks 等，最小环境消噪
            settingSources: [],
            systemPrompt: { type: 'preset', preset: 'claude_code' },
            stderr: (data: string) => console.error('[claude stderr]', data.trim()),
        },
    })

    let answer = ''
    for await (const message of q as AsyncIterable<SDKMessage>) {
        if (message.type === 'assistant') {
            const blocks = message.message.content
            if (Array.isArray(blocks)) {
                for (const block of blocks) {
                    if (block.type === 'text') answer += block.text
                }
            }
        }
    }

    const normalized = answer.trim().toLowerCase()
    console.log(`[verify-multimodal] 模型回复：${JSON.stringify(answer.trim().slice(0, 120))}`)

    const expectsColor = ['红', 'red'].some((kw) => normalized.includes(kw))
    if (answer.trim() === '') {
        console.error('[verify-multimodal] FAIL：assistant 无文本回复')
        process.exit(1)
    }
    if (!expectsColor) {
        console.error('[verify-multimodal] FAIL：回复未描述图像内容（期望红色相关回答）——多模态可能未透传')
        process.exit(1)
    }
    console.log('[verify-multimodal] PASS：模型正确描述了 base64 image block 内容——SDK streaming input 多模态透传实证通过')
}

main().catch((e) => {
    console.error('[verify-multimodal] ERROR:', e instanceof Error ? e.message : e)
    process.exit(1)
})
