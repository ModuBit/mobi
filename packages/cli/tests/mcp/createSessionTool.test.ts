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
import { createCreateSessionTool, CREATE_SESSION_TOOL_NAME } from '@/mcp/createSessionTool'

function buildDeps(result?: unknown) {
    const createSession = vi.fn().mockResolvedValue(result ?? { ok: true, sessionId: 's-new', readiness: 'ready' })
    return { deps: { createSession }, createSession }
}

describe('createCreateSessionTool', () => {
    it('exposes stable tool identity for mcp__mobi-apps__create_session prefix', () => {
        const { deps } = buildDeps()
        const tool = createCreateSessionTool(deps)

        expect(tool.name).toBe(CREATE_SESSION_TOOL_NAME)
        expect(tool.name).toBe('create_session')
    })

    it('description tells the model to reuse an existing session instead of creating one', () => {
        const { deps } = buildDeps()
        const desc = createCreateSessionTool(deps).description

        // 对齐 codex create_thread 的「create a separate task only when the user explicitly asks」
        expect(desc).toContain('only when a new working context is genuinely needed')
        expect(desc).toContain('use send_message_to_session instead')
    })

    it('description sends the model to list_machines for the id and refuses machine names', () => {
        const { deps } = buildDeps()
        const desc = createCreateSessionTool(deps).description

        expect(desc).toContain('Call list_machines first')
        expect(desc).toContain('does not accept a machine name')
    })

    it('description warns that creation is not instant and that failures come back in plain language', () => {
        const { deps } = buildDeps()
        const desc = createCreateSessionTool(deps).description

        // 起进程是慢操作——不写明的话模型会以为失败是瞬时重试就能好的
        expect(desc).toContain('Creation is not instant')
        expect(desc).toContain('Failures are reported in plain language')
    })

    it('description states that the new session starts empty and needs send_message_to_session', () => {
        const { deps } = buildDeps()
        const desc = createCreateSessionTool(deps).description

        expect(desc).toContain('starts with no first message')
        expect(desc).toContain('Give it work with send_message_to_session')
    })

    it('returns the new session id and points at the next step', async () => {
        const { deps } = buildDeps({ ok: true, sessionId: 's-new', readiness: 'ready' })
        const tool = createCreateSessionTool(deps)

        const result = await tool.execute({ machineId: 'm1', directory: '/work/app' })

        expect(result.isError).toBe(false)
        expect(result.content[0].text).toContain('s-new')
        expect(result.content[0].text).toContain('send_message_to_session')
        expect(result.content[0].text).toContain('no messages')
    })

    it('forwards every argument to the hub', async () => {
        const { deps, createSession } = buildDeps()
        const tool = createCreateSessionTool(deps)

        await tool.execute({
            machineId: 'm1',
            directory: '/work/app',
            projectId: 'p1',
            model: 'opus',
            effort: 'high',
            permissionMode: 'plan',
            title: '验收会话',
            waitForReady: false,
        })

        expect(createSession).toHaveBeenCalledWith({
            machineId: 'm1',
            directory: '/work/app',
            projectId: 'p1',
            model: 'opus',
            effort: 'high',
            permissionMode: 'plan',
            title: '验收会话',
            waitForReady: false,
        })
    })

    it('omits waitForReady when the model did not pass it (默认由 Hub 决定，不在工具侧编一个)', async () => {
        const { deps, createSession } = buildDeps()
        const tool = createCreateSessionTool(deps)

        await tool.execute({ machineId: 'm1', directory: '/work/app' })

        expect(createSession).toHaveBeenCalledWith({ machineId: 'm1', directory: '/work/app' })
    })

    it('description says the call waits until the new session can accept messages', () => {
        const { deps } = buildDeps()
        const desc = createCreateSessionTool(deps).description

        // 默认会等——模型得知道这一步可能要一两秒，不然会把等待当成卡住
        expect(desc).toContain('waits until that session can actually accept messages')
    })

    it('rejects a blank or oversized title without calling the hub', async () => {
        const { deps, createSession } = buildDeps()
        const tool = createCreateSessionTool(deps)

        for (const title of ['', 'x'.repeat(256)]) {
            const result = await tool.execute({ machineId: 'm1', directory: '/work/app', title })

            expect(result.isError).toBe(true)
        }
        expect(createSession).not.toHaveBeenCalled()
    })

    it('rejects a missing machineId, a blank directory, and an unknown effort without calling the hub', async () => {
        const { deps, createSession } = buildDeps()
        const tool = createCreateSessionTool(deps)

        // 都必须在此挡下：空 directory 会一路走到 runner 才报 "Directory is required"
        const missingMachine = await tool.execute({ directory: '/work/app' })
        const blankDirectory = await tool.execute({ machineId: 'm1', directory: '' })
        const badEffort = await tool.execute({ machineId: 'm1', directory: '/d', effort: 'max' })

        expect(missingMachine.isError).toBe(true)
        expect(blankDirectory.isError).toBe(true)
        expect(badEffort.isError).toBe(true)
        expect(createSession).not.toHaveBeenCalled()
    })

    it('passes the hub\'s plain-language failure through unwrapped', async () => {
        const message = 'No online machine with id "m1". Call list_machines to get the ids of machines that are reachable right now.'
        const { deps } = buildDeps({ ok: false, error: message })
        const tool = createCreateSessionTool(deps)

        const result = await tool.execute({ machineId: 'm1', directory: '/work/app' })

        // Hub 是唯一翻译点，且这些句子写成能独立读懂——再包一层前缀只会稀释它
        expect(result.isError).toBe(true)
        expect(result.content[0].text).toBe(message)
    })

    it('treats an ack timeout / socket error as a connection failure, not a hub rejection', async () => {
        const createSession = vi.fn().mockRejectedValue(new Error('operation has timed out'))
        const tool = createCreateSessionTool({ createSession })

        const result = await tool.execute({ machineId: 'm1', directory: '/work/app' })

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('timed out')
        // ack 没回来就不知道走到哪一步，不能套用 Hub 那句「可能已建」
        expect(result.content[0].text).not.toContain('may or may not have been created')
    })
})

describe('createCreateSessionTool — 建成功后的三种就绪措辞（D42）', () => {
    async function textFor(readiness: 'ready' | 'not-ready' | 'not-checked') {
        const { deps } = buildDeps({ ok: true, sessionId: 's-new', readiness })
        return (await createCreateSessionTool(deps).execute({ machineId: 'm1', directory: '/work/app' }))
    }

    it('ready → 明说现在就能收，可以直接派活', async () => {
        const result = await textFor('ready')

        expect(result.isError).toBe(false)
        expect(result.content[0].text).toContain('ready for messages now')
    })

    it('not-ready → 不算失败，但重点是拦住「再建一个」', async () => {
        const result = await textFor('not-ready')

        // 会话确实建好了，报错会让 agent 白白重来一遍并得到第二个会话
        expect(result.isError).toBe(false)
        expect(result.content[0].text).toContain('not accepting messages yet')
        expect(result.content[0].text).toContain('Do not create another session for this work')
        expect(result.content[0].text).toContain('s-new')
    })

    it('not-checked → 说清「这次没等」，因为没查过不等于不能收', async () => {
        const result = await textFor('not-checked')

        expect(result.isError).toBe(false)
        expect(result.content[0].text).toContain('still starting up')
        expect(result.content[0].text).not.toContain('not accepting messages yet')
    })
})
