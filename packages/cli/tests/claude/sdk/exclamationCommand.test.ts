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
 * 探索性测试：验证 Claude Agent SDK 对 "! command" 的处理行为
 *
 * 在 Claude Code CLI 交互模式中，输入 "! pwd" 会直接执行 shell 命令。
 * 本测试验证通过 SDK 发送相同消息时，SDK 是否也会执行 shell 命令。
 *
 * 结论：SDK 不会将 "! pwd" 视为本地命令，而是作为普通用户消息发送给 Claude。
 * "! command" 是 CLI 交互层的功能，不属于 SDK/Agent 层。
 *
 * 注意：此测试依赖本地 Claude Code SDK 环境，CI 中自动跳过
 * 运行方式：bun test tests/claude/sdk/exclamationCommand.test.ts
 */

import { describe, it, expect } from 'vitest'

// CI 环境下跳过（需要本地 Claude Code SDK 环境）
const skip = !!process.env.CI
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'

describe('SDK ! command 行为探索', () => {
    it('发送 "! pwd" 不会产生 local_command_output，而是走正常 API 流程', { timeout: 30_000, skip }, async () => {
        const messages: SDKMessage[] = []
        let gotInit = false

        const response = query({
            prompt: '! pwd',
            options: {
                cwd: process.cwd(),
                permissionMode: 'bypassPermissions',
            },
        })

        for await (const message of response) {
            messages.push(message)
            const subtype = 'subtype' in message ? message.subtype : '-'
            console.log(`[Message] type=${message.type}, subtype=${subtype}`)

            // init 表示会话已初始化，之后会开始调 API
            if (message.type === 'system' && subtype === 'init') {
                gotInit = true
                console.log('[Init] 会话初始化完成，关闭 query')
                response.close()
                break
            }

            // 如果出现 local_command_output，说明 SDK 处理了 ! 命令
            if (message.type === 'system' && subtype === 'local_command_output') {
                console.log(`[LocalCommandOutput] ! 命令被 SDK 执行了！content: ${(message as any).content}`)
            }
        }

        // 打印消息统计
        console.log(`\n总共收到 ${messages.length} 条消息:`)
        for (const m of messages) {
            const subtype = 'subtype' in m && m.subtype ? `/${m.subtype}` : ''
            console.log(`  - ${m.type}${subtype}`)
        }

        // 关键断言：! pwd 没有被当作本地命令执行
        const localCmdOutput = messages.find(
            m => m.type === 'system' && 'subtype' in m && m.subtype === 'local_command_output'
        )
        expect(localCmdOutput).toBeUndefined()
        console.log('\n✓ 确认：SDK 不处理 ! 命令，"! pwd" 作为普通消息发送给 Claude')

        expect(gotInit).toBe(true)
    })
})
