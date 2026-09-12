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
import { createListMachinesTool, createListMachinesToolForSession, LIST_MACHINES_TOOL_NAME } from '@/mcp/listMachinesTool'
import type { ApiSessionClient } from '@/api/apiSession'
import type { AgentMachineSummary } from '@mobi/shared'

const MACHINES: AgentMachineSummary[] = [
    { machineId: 'm-1', name: 'Mac Mini', hostname: 'mini.local', activeAt: 1_700_000_000_000 },
    { machineId: 'm-2', name: 'Studio', hostname: 'studio.local', activeAt: 1_700_000_060_000 },
]

function buildDeps(result?: unknown) {
    const listMachines = vi.fn().mockResolvedValue(result ?? { ok: true, machines: MACHINES })
    return { deps: { listMachines }, listMachines }
}

describe('createListMachinesTool', () => {
    it('exposes stable tool identity for mcp__mobi-apps__list_machines prefix', () => {
        const { deps } = buildDeps()
        const tool = createListMachinesTool(deps)

        expect(tool.name).toBe(LIST_MACHINES_TOOL_NAME)
        expect(tool.name).toBe('list_machines')
    })

    it('description carries retrieval keywords and the create_session input contract', () => {
        const { deps } = buildDeps()
        const tool = createListMachinesTool(deps)
        const desc = tool.description.toLowerCase()

        // 检索关键词（tool search defer 场景按描述命中）
        expect(desc).toContain('machine')
        expect(desc).toContain('online')
        expect(desc).toContain('reachable')
        // 与 create_session 的输入契约：只收 id、不收机器名
        expect(tool.description).toContain('create_session')
        expect(tool.description).toContain('machineId')
        expect(desc).toContain('will not accept a machine name')
    })

    it('renders machineId (the value create_session needs) for every online machine', async () => {
        const { deps, listMachines } = buildDeps()
        const tool = createListMachinesTool(deps)

        const result = await tool.execute({})

        expect(listMachines).toHaveBeenCalledTimes(1)
        expect(result.isError).toBe(false)
        expect(result.content[0].text).toContain('m-1')
        expect(result.content[0].text).toContain('m-2')
        expect(result.content[0].text).toContain('Mac Mini')
    })

    it('renders ISO heartbeat time', async () => {
        const { deps } = buildDeps()
        const tool = createListMachinesTool(deps)

        const result = await tool.execute({})

        expect(result.content[0].text).toContain(new Date(1_700_000_000_000).toISOString())
    })

    it('treats an empty list as success, explaining that no session can be started now', async () => {
        const { deps } = buildDeps({ ok: true, machines: [] })
        const tool = createListMachinesTool(deps)

        const result = await tool.execute({})

        // 空态不是错误（真的一台都没在线），但必须说清后果
        expect(result.isError).toBe(false)
        expect(result.content[0].text).toContain('No machine is currently online')
    })

    it('surfaces a hub rejection as an error carrying the reason', async () => {
        const { deps } = buildDeps({ ok: false, reason: 'access-denied' })
        const tool = createListMachinesTool(deps)

        const result = await tool.execute({})

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('access-denied')
    })

    it('treats an ack timeout / socket error as a connection failure, not a hub rejection', async () => {
        const listMachines = vi.fn().mockRejectedValue(new Error('operation has timed out'))
        const tool = createListMachinesTool({ listMachines })

        const result = await tool.execute({})

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('timed out')
        // 连接故障不能伪装成业务拒绝——文案里不出现 reason 字段的措辞
        expect(result.content[0].text).not.toContain('rejected by mobi hub')
    })

    it('accepts a missing argument object (no inputs)', async () => {
        const { deps, listMachines } = buildDeps()
        const tool = createListMachinesTool(deps)

        await tool.execute(undefined)

        expect(listMachines).toHaveBeenCalledTimes(1)
    })

    it('wires the session client channel', async () => {
        const client = { listOnlineMachinesForAgent: vi.fn().mockResolvedValue({ ok: true, machines: MACHINES }) }
        const tool = createListMachinesToolForSession(client as unknown as ApiSessionClient)

        const result = await tool.execute({})

        expect(client.listOnlineMachinesForAgent).toHaveBeenCalledTimes(1)
        expect(result.isError).toBe(false)
    })
})
