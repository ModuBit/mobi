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

import { describe, it, expect, vi } from 'vitest'
import { createSendMessageTool, createSendMessageToolForSession, SEND_MESSAGE_TOOL_NAME } from '@/mcp/sendMessageTool'
import type { AgentSendMessageAck } from '@mobi/shared'
import type { ApiSessionClient } from '@/api/apiSession'

function buildDeps(result?: AgentSendMessageAck) {
    const sendMessage = vi.fn().mockResolvedValue(
        result ?? { ok: true, results: [{ sessionId: 'B', ok: true }] },
    )
    return { deps: { sendMessage }, sendMessage }
}

describe('createSendMessageTool', () => {
    it('exposes stable tool identity for the mcp__mobi-apps__send_message_to_session prefix', () => {
        const { deps } = buildDeps()
        const tool = createSendMessageTool(deps)

        expect(tool.name).toBe(SEND_MESSAGE_TOOL_NAME)
        expect(tool.name).toBe('send_message_to_session')
    })

    it('description tells the model to stop waiting and warns that this is final', () => {
        const { deps } = buildDeps()
        const desc = createSendMessageTool(deps).description

        expect(desc).toContain('Do not wait for a reply')
        expect(desc).toContain('cannot be cancelled')
    })

    it('description says only text blocks work right now', () => {
        const { deps } = buildDeps()
        const desc = createSendMessageTool(deps).description

        // schema 收四型 block，但非 text 会被整条拒绝——不写明模型就会照着 schema 发图片
        expect(desc).toContain('Only text blocks are supported right now')
    })

    it('forwards targets and content to the hub untouched', async () => {
        const { deps, sendMessage } = buildDeps()
        const tool = createSendMessageTool(deps)

        await tool.execute({ targets: ['B', 'C'], content: 'hello there' })

        expect(sendMessage).toHaveBeenCalledWith({ targets: ['B', 'C'], content: 'hello there' })
    })

    it('rejects an empty target list and empty ids without calling the hub', async () => {
        const { deps, sendMessage } = buildDeps()
        const tool = createSendMessageTool(deps)

        // 空 targets 是「什么都不做」——失败比成功更好，成功会让模型以为话带到了
        const noTargets = await tool.execute({ targets: [], content: 'hi' })
        const blankTarget = await tool.execute({ targets: [''], content: 'hi' })

        expect(noTargets.isError).toBe(true)
        expect(blankTarget.isError).toBe(true)
        expect(sendMessage).not.toHaveBeenCalled()
    })

    it('all delivered → success text names the targets and does not invent a message id', async () => {
        const { deps } = buildDeps({ ok: true, results: [{ sessionId: 'B', ok: true }, { sessionId: 'C', ok: true }] })
        const tool = createSendMessageTool(deps)

        const result = await tool.execute({ targets: ['B', 'C'], content: 'hi' })

        expect(result.isError).toBe(false)
        expect(result.content[0].text).toContain('Sent to 2 sessions')
        expect(result.content[0].text).toContain('B, C')
    })

    it('single target reads in the singular', async () => {
        const { deps } = buildDeps({ ok: true, results: [{ sessionId: 'B', ok: true }] })
        const tool = createSendMessageTool(deps)

        const result = await tool.execute({ targets: ['B'], content: 'hi' })

        expect(result.content[0].text).toContain('Sent to session: B')
    })

    it('partial success is not an error, but every failure is spelled out', async () => {
        const { deps } = buildDeps({
            ok: true,
            results: [
                { sessionId: 'B', ok: true },
                { sessionId: 'C', ok: false, error: 'Session "C" is not running any more, so it cannot receive messages.' },
            ],
        })
        const tool = createSendMessageTool(deps)

        const result = await tool.execute({ targets: ['B', 'C'], content: 'hi' })

        // 部分成功不是错误：逐条清单已说清谁没收到，标错只会让模型以为整批要重来
        expect(result.isError).toBe(false)
        expect(result.content[0].text).toContain('Sent to 1 of 2 sessions')
        expect(result.content[0].text).toContain('Delivered: B')
        expect(result.content[0].text).toContain('C: NOT delivered')
        // hub 的句子是写成能独立读懂的，原样透出而不是被改写
        expect(result.content[0].text).toContain('is not running any more')
    })

    it('every target failing is an error — the send did not happen', async () => {
        const { deps } = buildDeps({
            ok: true,
            results: [
                { sessionId: 'B', ok: false, error: 'gone' },
                { sessionId: 'C', ok: false, error: 'also gone' },
            ],
        })
        const tool = createSendMessageTool(deps)

        const result = await tool.execute({ targets: ['B', 'C'], content: 'hi' })

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('None of the 2 targets received the message')
    })

    it('a top-level rejection says outright that nothing was sent', async () => {
        const { deps } = buildDeps({ ok: false, reason: 'access-denied' })
        const tool = createSendMessageTool(deps)

        const result = await tool.execute({ targets: ['B'], content: 'hi' })

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('access-denied')
        expect(result.content[0].text).toContain('Nothing was sent')
    })

    it('treats an ack timeout / socket error as a connection failure, not a delivery result', async () => {
        const sendMessage = vi.fn().mockRejectedValue(new Error('operation has timed out'))
        const tool = createSendMessageTool({ sendMessage })

        const result = await tool.execute({ targets: ['B'], content: 'hi' })

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('timed out')
        // ack 没回来就不知道 hub 走到哪一步，不能套用「可能已送达」那句话
        expect(result.content[0].text).not.toContain('may or may not have been delivered')
    })

    it('wires the session client channel', async () => {
        const client = {
            sendMessageToSessionsForAgent: vi.fn().mockResolvedValue({ ok: true, results: [{ sessionId: 'B', ok: true }] }),
        }
        const tool = createSendMessageToolForSession(client as unknown as ApiSessionClient)

        const result = await tool.execute({ targets: ['B'], content: 'hi' })

        expect(client.sendMessageToSessionsForAgent).toHaveBeenCalledWith({ targets: ['B'], content: 'hi' })
        expect(result.isError).toBe(false)
    })
})
