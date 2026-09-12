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
 * list_machines 核心工具工厂（agent-sessions B 类系统操作族）。
 *
 * agent 触达其他会话的第一步：知道自己能把新会话开在哪些机器上。
 * 机器 id 是 create_session 的唯一合法输入，所以本工具是那条路径的入口。
 *
 * 回执三分支（与 open_in_mobi 同口径，勿混淆）：
 * - ok:true + 非空清单 → 正常返回
 * - ok:true + 空清单 → **成功非错误**（真的一台都没在线），平和告知
 * - ok:false / emitWithAck reject → isError（业务拒绝与连接故障都归此，
 *   但内容上要能分辨——reject 的文案不提 reason，见下方分支）
 *
 * 仅挂 remote 壳（mobiAppsServer）：B 类链路依赖 Hub，local 模式无此通道。
 */

import { z } from 'zod'
import type { AgentMachineSummary } from '@mobi/shared'
import type { ApiSessionClient } from '@/api/apiSession'
import { errorTextResult, textResult, type MobiToolTextResult } from './toolResult'

export const LIST_MACHINES_TOOL_NAME = 'list_machines' as const

export interface ListMachinesToolDeps {
    /** 向 Hub 要在线机器（emitWithAck 等回执，见 ApiSessionClient.listOnlineMachinesForAgent） */
    listMachines: () => Promise<
        | { ok: true; machines: AgentMachineSummary[] }
        | { ok: false; reason: string }
    >
}

export type ListMachinesToolResult = MobiToolTextResult

/** 清单渲染：一行一台，字段名与工具描述里的措辞对齐（machineId / name / host） */
function renderMachines(machines: AgentMachineSummary[]): string {
    const lines = machines.map((m) =>
        `- machineId: ${m.machineId} | name: ${m.name} | host: ${m.hostname} | last heartbeat: ${new Date(m.activeAt).toISOString()}`
    )
    return `${machines.length} machine${machines.length === 1 ? '' : 's'} online:\n${lines.join('\n')}`
}

export function createListMachinesTool(deps: ListMachinesToolDeps) {
    // 无入参：本工具描述的是"当下在线的机器"，没有任何可调维度
    const listMachinesInputSchema = z.object({})

    async function execute(rawArgs: unknown): Promise<ListMachinesToolResult> {
        const parsed = listMachinesInputSchema.safeParse(rawArgs ?? {})
        if (!parsed.success) {
            return errorTextResult('Failed to list machines: invalid arguments', parsed.error)
        }

        let answer: Awaited<ReturnType<ListMachinesToolDeps['listMachines']>>
        try {
            answer = await deps.listMachines()
        } catch (error) {
            // socket 断开 / ack 超时：连接故障。此处不提 reason——reason 是业务拒绝的字段
            return errorTextResult('Failed to reach mobi hub', error)
        }

        if (!answer.ok) {
            return {
                content: [{ type: 'text', text: `The machine list was rejected by mobi hub (${answer.reason}).` }],
                isError: true,
            }
        }

        // 空清单是**成功**：确实一台都没在线，不是错误。但要说清后果——
        // agent 需要知道此刻建不了新会话，而不是以为工具坏了
        if (answer.machines.length === 0) {
            return textResult(
                'No machine is currently online, so no new session can be started right now. ' +
                'Existing sessions may still be reachable — try list_sessions.',
            )
        }

        return textResult(renderMachines(answer.machines))
    }

    return {
        name: LIST_MACHINES_TOOL_NAME,
        // 描述含检索关键词（machine / host / online / where to create a session），
        // 并写明与 create_session 的输入契约——tools search defer 场景按描述命中
        description:
            'List the machines that are online and reachable right now. ' +
            'Use a returned machineId with create_session — that tool requires an explicit id and will not accept a machine name. ' +
            'A machine absent from this list has no CLI running, so no new session can be started on it.',
        title: 'List Machines',
        inputSchema: listMachinesInputSchema,
        execute,
    }
}

export type ListMachinesTool = ReturnType<typeof createListMachinesTool>

/** 会话场景组装入口（仅 remote 壳 mobiAppsServer 使用） */
export function createListMachinesToolForSession(client: ApiSessionClient) {
    return createListMachinesTool({
        listMachines: () => client.listOnlineMachinesForAgent(),
    })
}
