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
 * 本 server 工具族的装配点测试。
 *
 * 此前「工具 ↔ 会话通道」的对应关系由五个 `createXxxToolForSession(client)`（各三行、
 * 只转发一个方法）各自守着，一个文件一条用例；装配收进 `buildMobiAppsTools` 之后，
 * 对应关系集中在一处，用例也跟着集中——**每个通道恰好被调一次**就是「没串线」的判据：
 * 哪个工具接错了通道，都会露出一个 2 次、一个 0 次。
 */

import { describe, it, expect, vi } from 'vitest'
import { MOBI_APPS_TOOL_NAMES, buildMobiAppsTools } from '@/mcp/mobiAppsServer'
import type { ApiSessionClient } from '@/api/apiSession'
import { OPEN_IN_MOBI_TOOL_NAME } from '@/mcp/openInMobiTool'
import { LIST_MACHINES_TOOL_NAME } from '@/mcp/listMachinesTool'
import { LIST_SESSIONS_TOOL_NAME } from '@/mcp/listSessionsTool'
import { CREATE_SESSION_TOOL_NAME } from '@/mcp/createSessionTool'
import { SEND_MESSAGE_TOOL_NAME } from '@/mcp/sendMessageTool'

/** 五个通道各一个 vi.fn——分开记数才能证明「哪个工具接哪条通道」 */
function makeClient() {
    return {
        sendUiCommand: vi.fn().mockResolvedValue({ delivered: true }),
        listOnlineMachinesForAgent: vi.fn().mockResolvedValue({ ok: true, machines: [] }),
        listSessionsForAgent: vi.fn().mockResolvedValue({ ok: true, sessions: [] }),
        createSessionForAgent: vi.fn().mockResolvedValue({ ok: true, sessionId: 's-new', readiness: 'ready' }),
        sendMessageToSessionsForAgent: vi.fn().mockResolvedValue({ ok: true, results: [{ sessionId: 'B', ok: true }] }),
    }
}

describe('buildMobiAppsTools', () => {
    it('五个工具各自接上自己的会话通道，入参原样透传', async () => {
        const client = makeClient()
        const byName = new Map(
            buildMobiAppsTools(client as unknown as ApiSessionClient).map((tool) => [tool.name, tool])
        )

        await byName.get(OPEN_IN_MOBI_TOOL_NAME)!.execute({ target: { type: 'file', path: '/tmp/demo/a.ts' } })
        expect(client.sendUiCommand).toHaveBeenCalledWith({
            action: 'open_in_mobi',
            payload: { type: 'file', path: '/tmp/demo/a.ts' },
        })

        await byName.get(LIST_MACHINES_TOOL_NAME)!.execute({})
        expect(client.listOnlineMachinesForAgent).toHaveBeenCalledTimes(1)

        await byName.get(LIST_SESSIONS_TOOL_NAME)!.execute({ status: 'ALL', limit: 3 })
        expect(client.listSessionsForAgent).toHaveBeenCalledWith({ status: 'ALL', limit: 3 })

        await byName.get(CREATE_SESSION_TOOL_NAME)!.execute({ machineId: 'm1', directory: '/work/app' })
        expect(client.createSessionForAgent).toHaveBeenCalledWith({ machineId: 'm1', directory: '/work/app' })

        await byName.get(SEND_MESSAGE_TOOL_NAME)!.execute({ targets: ['B'], content: 'hi' })
        expect(client.sendMessageToSessionsForAgent).toHaveBeenCalledWith({ targets: ['B'], content: 'hi' })

        // 没串线：五条通道各被调一次（接错的话会是一个 2 次、一个 0 次）
        expect(client.sendUiCommand).toHaveBeenCalledTimes(1)
        expect(client.listOnlineMachinesForAgent).toHaveBeenCalledTimes(1)
        expect(client.listSessionsForAgent).toHaveBeenCalledTimes(1)
        expect(client.createSessionForAgent).toHaveBeenCalledTimes(1)
        expect(client.sendMessageToSessionsForAgent).toHaveBeenCalledTimes(1)
    })

    it('表里写的名字与它造出来的工具名一致（预授权清单从这张表派生）', () => {
        // 一行 = 名字 + 怎么造：两者可以各写各的，配错（把 A 的名字安在 B 的工位上）会让
        // 派生出去的预授权串指向一个不存在的工具——症状同上，静默失效
        expect(buildMobiAppsTools(makeClient() as unknown as ApiSessionClient).map((tool) => tool.name))
            .toEqual([...MOBI_APPS_TOOL_NAMES])
    })
})
