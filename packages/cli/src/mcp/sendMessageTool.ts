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
 * send_message_to_session 核心工具工厂（agent-sessions B 类系统操作族）。
 *
 * **本特性的核心**：会话 A 里的 agent 把一条消息投给会话 B，B 的 agent 收到它、
 * 看出它来自哪个会话、再用同一个工具回信给 A。
 *
 * 失败文案**不由本工具拼**：Hub 侧 AgentSessionService 是唯一翻译点（含 RPC 内部
 * 错误 → 人话 + 逐目标结果）。本工具只把自己产生的连接故障译出来，其余原样透出。
 *
 * 回执不是「成功/失败」两态而是**逐目标清单**（D15/D16）：扇出不做事务，
 * 部分成功就是部分成功。顶层 isError 只在**一个目标都没成**时置位——
 * 那时「发消息」这件事确实没发生。
 *
 * 仅挂 remote 壳（mobiAppsServer）：B 类链路依赖 Hub，local 模式无此通道。
 */

import { z } from 'zod'
import { UserMessageContentSchema } from '@mobi/shared'
import type { AgentSendMessageAck, AgentSendMessageRequest, AgentSendMessageTargetResult } from '@mobi/shared'
import type { ApiSessionClient } from '@/api/apiSession'
import { errorTextResult, textResult, type MobiToolTextResult } from './toolResult'

export const SEND_MESSAGE_TOOL_NAME = 'send_message_to_session' as const

export interface SendMessageToolDeps {
    /** 把消息投给若干会话（emitWithAck 等回执，见 ApiSessionClient.sendMessageToSessionsForAgent） */
    sendMessage: (input: Omit<AgentSendMessageRequest, 'sid'>) => Promise<AgentSendMessageAck>
}

export type SendMessageToolResult = MobiToolTextResult

/** 失败条目：hub 的句子写在能独立读懂的前提下，所以这里是「说明 + 原句」而非改写它 */
function renderFailure(result: AgentSendMessageTargetResult): string {
    return `- ${result.sessionId}: NOT delivered — ${result.error ?? 'no reason given'}`
}

/**
 * 逐目标清单渲染。
 *
 * 全成与部分成分别给不同的话：全成时不需要 agent 做任何事（重点是「别等回复」），
 * 部分成时它必须知道自己还有没送到的地方、而且**不能盲目重发**（超时那份可能已经送达，
 * 这句话由 hub 的目标条目给出）。
 */
export function renderDeliveryResults(results: readonly AgentSendMessageTargetResult[]): string {
    const delivered = results.filter((result) => result.ok)
    const failed = results.filter((result) => !result.ok)
    const total = results.length

    if (failed.length === 0) {
        const who = delivered.map((result) => result.sessionId).join(', ')
        return (
            `Sent to ${total === 1 ? 'session' : `${total} sessions`}: ${who}. ` +
            'Each receives it as a user message tagged with this session, and can reply with this same tool. ' +
            'Do not wait for a reply — there is no tool that waits; end your turn, and the answer arrives later as a new message.'
        )
    }

    if (delivered.length === 0) {
        return (
            `None of the ${total} target${total === 1 ? '' : 's'} received the message.\n` +
            failed.map(renderFailure).join('\n')
        )
    }

    return (
        `Sent to ${delivered.length} of ${total} sessions.\n` +
        `Delivered: ${delivered.map((result) => result.sessionId).join(', ')}\n` +
        'Not delivered:\n' +
        failed.map(renderFailure).join('\n') +
        '\nRead each reason before retrying — some failures must not be retried blindly.'
    )
}

export function createSendMessageTool(deps: SendMessageToolDeps) {
    const sendMessageInputSchema = z.object({
        targets: z.array(z.string().min(1)).min(1).describe(
            'Session ids from list_sessions. Every target must be active. Failures are reported per target.',
        ),
        content: UserMessageContentSchema.describe(
            'Usually just a plain string. Also accepts the composer block forms: text, quote, image, document.',
        ),
    })

    async function execute(rawArgs: unknown): Promise<SendMessageToolResult> {
        const parsed = sendMessageInputSchema.safeParse(rawArgs ?? {})
        if (!parsed.success) {
            return errorTextResult('Failed to send the message: invalid arguments', parsed.error)
        }

        let answer: AgentSendMessageAck
        try {
            answer = await deps.sendMessage(parsed.data)
        } catch (error) {
            // socket 断开 / ack 超时：连接故障。此处**不能**说「可能已送达」——
            // ack 没回来，连 hub 走到哪一步都不知道
            return errorTextResult('Failed to reach mobi hub', error)
        }

        if (!answer.ok) {
            // 顶层拒绝（入参形状 / 鉴权 / 装配）：一个字都没发出去
            return {
                content: [{ type: 'text', text: `The message was rejected by mobi hub (${answer.reason}). Nothing was sent.` }],
                isError: true,
            }
        }

        const text = renderDeliveryResults(answer.results)
        // 一个都没成 = 「发消息」这件事没发生 → isError。部分成不算错：
        // 逐条清单已经说清谁没收到，标成错误只会让 agent 以为整批要重来
        const allFailed = answer.results.length > 0 && answer.results.every((result) => !result.ok)
        return allFailed ? { content: [{ type: 'text', text }], isError: true } : textResult(text)
    }

    return {
        name: SEND_MESSAGE_TOOL_NAME,
        // 描述照 codex 的写法（散文、无 markdown 结构、第一句直说做什么），重点在
        // **边界**（只有 active 能收、附件限同机器、最终不可撤回）与**跨工具协作**
        // （id 来自 list_sessions；收件方用同一个工具回信）
        //
        // 附件段的末句是「说实话」的那一句：块里给 URL **不会被取回**——CLI 的
        // blocks→prompt 转换只会 readFileSync（`buildPromptFromBlocks`），https 与
        // data: 一律失败并降级成 `@值` 文本。原先那句「网络图就写 URL」推荐了一件
        // 做不到的事，而 hub 侧的自足 URL 判据又正好放行它，于是「报成功、对面拿到
        // 一段文本」。这里改成如实描述，让 agent 自己选：给本机文件，或把 URL 写进正文
        description:
            'Send a message to one or more sessions. Each target receives it as a user message tagged with this session, ' +
            'so the receiving agent can see where it came from and reply with this same tool. ' +
            'Pass session ids from list_sessions. Every target must be active — a session whose process has exited cannot ' +
            'receive messages, and failures are reported per target. ' +
            'content takes the same forms as the mobi composer: usually plain text, or blocks of type text, quote, image, ' +
            'and document. Write clear, cohesive, human-readable prose — the receiving agent reads this the way it reads ' +
            'a message from the user. ' +
            'image and document blocks must point at files on your own machine, and every target must be on that same ' +
            'machine; a local file cannot reach a session on another machine, and such a send fails rather than silently ' +
            'dropping the file. Nothing fetches URLs: a block whose value is an online URL or a data: URL is not ' +
            'delivered as an image or a file — the target receives the value as plain text it would have to fetch ' +
            'itself, and a data: URL only burns context. Either attach a local file, or put the URL in the message text. ' +
            'Do not wait for a reply. There is no tool that waits — end your turn, and the target\'s response arrives later ' +
            'as a new message. The receiving agent will not stop what it is doing to handle your message; it sees it ' +
            'alongside its next tool result. ' +
            'Messages sent this way are final: they do not enter the recipient\'s submission queue, they cannot be cancelled ' +
            'or edited, and they appear in the web UI like any other cross-session message.',
        title: 'Send Message To Session',
        inputSchema: sendMessageInputSchema,
        execute,
    }
}

export type SendMessageTool = ReturnType<typeof createSendMessageTool>

/** 会话场景组装入口（仅 remote 壳 mobiAppsServer 使用） */
export function createSendMessageToolForSession(client: ApiSessionClient) {
    return createSendMessageTool({
        sendMessage: (input) => client.sendMessageToSessionsForAgent(input),
    })
}
