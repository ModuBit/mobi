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
 * 探索性测试：验证 Claude Agent SDK 对 LaTeX $...$ 语法是否触发 prompt injection 过滤器
 *
 * 背景：用户发送包含 $a^2 + b^2 = c^2$ 的消息时，Claude API 返回 400 invalid_request_error。
 * 本测试直接调用 SDK，验证该限制是否真实存在。
 *
 * 注意：此测试依赖本地 Claude Code SDK 环境（需配置 API key），CI 中自动跳过。
 * 运行方式：bun test tests/claude/sdk/latexPromptFilter.test.ts
 */

import { describe, it, expect } from 'vitest'

// CI 或无 API key 环境下跳过
const shouldSkip = !!process.env.CI || !process.env.ANTHROPIC_API_KEY

const describeIfEnabled = shouldSkip ? describe.skip : describe

describeIfEnabled('SDK LaTeX $...$ prompt injection 过滤器', () => {
    it('发送包含 $a^2 + b^2 = c^2$ 的消息会触发 API 异常（超时或无响应）', { timeout: 30_000 }, async () => {
        const { query } = await import('@anthropic-ai/claude-agent-sdk')
        const messages: unknown[] = []
        let gotAssistant = false

        const response = query({
            prompt: '使用 latex 推导一下勾股定理 $a^2 + b^2 = c^2$',
            options: {
                cwd: process.cwd(),
                permissionMode: 'bypassPermissions',
                pathToClaudeCodeExecutable: '/home/admin/.local/bin/claude',
            },
        })

        // 10 秒内未收到 assistant 消息则主动关闭，避免无限等待
        const timer = setTimeout(() => {
            console.log('[Timeout] 10s 内未收到 assistant 消息，主动关闭')
            response.close()
        }, 10_000)

        try {
            for await (const message of response) {
                messages.push(message)
                const subtype = 'subtype' in message ? message.subtype : '-'
                console.log(`[Message] type=${message.type}, subtype=${subtype}`)

                if (message.type === 'assistant') {
                    gotAssistant = true
                    console.log('[Assistant]', JSON.stringify((message as any).message, null, 2))
                    response.close()
                    break
                }

                if (message.type === 'result') {
                    console.log('[Result]', JSON.stringify(message, null, 2))
                    break
                }
            }
        } catch (e) {
            // SDK 可能抛出异常（如进程退出），这本身也说明异常
            console.log('Caught error:', String(e))
        } finally {
            clearTimeout(timer)
        }

        console.log(`\n总共收到 ${messages.length} 条消息`)

        // 关键断言：正常情况下应该收到 assistant 消息
        // 如果 $...$ 触发过滤器，则要么收不到 assistant、要么收到错误
        const assistantMsgs = messages.filter(m => m.type === 'assistant')
        const hasApiError = assistantMsgs.some((m: any) => {
            const content = m.message?.content
            const text = Array.isArray(content)
                ? content.map((c: any) => c.text || '').join('')
                : String(content || '')
            return text.includes('API Error') || text.includes('invalid_request_error')
        })

        // 断言：要么收到 API Error，要么没有收到正常的 assistant 消息
        // （对比测试 2：\(...\) 可以正常收到 assistant 响应）
        expect(
            hasApiError || !gotAssistant,
        ).toBe(true)

        if (hasApiError) {
            console.log('\n✓ 确认：收到 API Error，$...$ 被拦截')
        } else if (!gotAssistant) {
            console.log('\n✓ 确认：未收到 assistant 消息，$...$ 导致请求异常（超时或进程退出）')
        }
    })

    it('发送 \\(...\\) 语法的等价消息可正常通过', { timeout: 30_000 }, async () => {
        const { query } = await import('@anthropic-ai/claude-agent-sdk')
        const messages: unknown[] = []
        let assistantMsg: unknown = null
        let resultMsg: unknown = null

        const response = query({
            prompt: '使用 latex 推导一下勾股定理 \\(a^2 + b^2 = c^2\\)',
            options: {
                cwd: process.cwd(),
                permissionMode: 'bypassPermissions',
                pathToClaudeCodeExecutable: '/home/admin/.local/bin/claude',
            },
        })

        for await (const message of response) {
            messages.push(message)

            if (message.type === 'assistant') {
                assistantMsg = message
            }

            if (message.type === 'result') {
                resultMsg = message
                response.close()
                break
            }
        }

        const content = (assistantMsg as any)?.message?.content
        const text = Array.isArray(content)
            ? content.map((c: any) => c.text || '').join('')
            : String(content || '')

        console.log('\nAssistant 消息内容:', text.substring(0, 200))

        // 关键断言：不包含 API Error（正常响应）
        expect(text).not.toContain('API Error')
        expect(text).not.toContain('invalid_request_error')

        // result 消息不应标记为错误
        expect((resultMsg as any)?.is_error).not.toBe(true)

        console.log('\n✓ 确认：\\(...\\) 语法可正常通过，未触发过滤')
    })
})
