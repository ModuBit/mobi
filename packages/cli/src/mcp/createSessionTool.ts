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
 * create_session 核心工具工厂（agent-sessions B 类系统操作族）。
 *
 * 与 send_message_to_session 拆成两个工具的理由是**错误定位**（D12）：建失败的
 * 原因（机器离线 / 目录建不出来 / 那台机器没在跑 / 超时）与投递失败的原因
 * （目标进程不在）是两类完全不同的失败，合在一个工具里 agent 分不清该重试哪个。
 *
 * 失败文案**不由本工具拼**：Hub 侧 AgentSessionService 是唯一翻译点（含 RPC 内部
 * 错误 → 人话）。本工具只把自己产生的连接故障译出来，其余原样透出——那几句是
 * 写成能独立读懂的一整句的。
 *
 * 仅挂 remote 壳（mobiAppsServer）：B 类链路依赖 Hub，local 模式无此通道。
 */

import { z } from 'zod'
import { EFFORT_LEVELS, PermissionModeSchema } from '@mobi/shared'
import type { AgentCreateSessionAck, AgentCreateSessionRequest } from '@mobi/shared'
import type { ApiSessionClient } from '@/api/apiSession'
import { errorTextResult, textResult, type MobiToolTextResult } from './toolResult'

export const CREATE_SESSION_TOOL_NAME = 'create_session' as const

export interface CreateSessionToolDeps {
    /** 让 Hub 起会话（emitWithAck 等回执，见 ApiSessionClient.createSessionForAgent） */
    createSession: (input: Omit<AgentCreateSessionRequest, 'sid'>) => Promise<AgentCreateSessionAck>
}

export type CreateSessionToolResult = MobiToolTextResult

export function createCreateSessionTool(deps: CreateSessionToolDeps) {
    const createSessionInputSchema = z.object({
        machineId: z.string().min(1).describe(
            'A machineId returned by list_machines. Must be the id itself — a machine name is not accepted.',
        ),
        directory: z.string().min(1).describe(
            'Absolute path on that machine, resolved there. Created if it does not exist.',
        ),
        projectId: z.string().optional().describe(
            'Optional project id to file the new session under. Omit for a loose session.',
        ),
        model: z.string().optional().describe(
            'Optional model for the new session. Omit to take the mobi default.',
        ),
        effort: z.enum(EFFORT_LEVELS).optional().describe(
            'Optional effort level for the new session. Omit to take the mobi default.',
        ),
        permissionMode: PermissionModeSchema.optional().describe(
            'Optional permission mode for the new session. Omit to take the mobi default.',
        ),
        title: z.string().min(1).max(255).optional().describe(
            'Optional title for the new session. This is only its initial name — the new session may rename itself later. ' +
            'Omit to leave it unnamed.',
        ),
    })

    async function execute(rawArgs: unknown): Promise<CreateSessionToolResult> {
        const parsed = createSessionInputSchema.safeParse(rawArgs ?? {})
        if (!parsed.success) {
            return errorTextResult('Failed to create the session: invalid arguments', parsed.error)
        }

        let answer: AgentCreateSessionAck
        try {
            answer = await deps.createSession(parsed.data)
        } catch (error) {
            // socket 断开 / ack 超时：连接故障。与业务失败（Hub 给的人话）语义不同，
            // 且此处**不能**沿用「可能已建」的说法——ack 没回来根本不知道走到哪一步
            return errorTextResult('Failed to reach mobi hub', error)
        }

        if (!answer.ok) {
            // Hub 已把失败译成人话（含「可能已建，先 list_sessions」这类行动指引），原样透出
            return { content: [{ type: 'text', text: answer.error }], isError: true }
        }

        return textResult(
            `Created session ${answer.sessionId} (machine ${parsed.data.machineId}, directory ${parsed.data.directory}). ` +
            'It starts with no messages — give it work with send_message_to_session.',
        )
    }

    return {
        name: CREATE_SESSION_TOOL_NAME,
        // 描述照 codex 的写法（散文、无 markdown 结构、第一句直说做什么），重点在
        // **使用边界**（能复用已有会话就别新建，对齐 codex create_thread 的
        // "Create a separate task only when the user explicitly asks"）与**跨工具协作**
        description:
            'Start a new mobi session on one machine. ' +
            'Create a session only when a new working context is genuinely needed — ' +
            'when the work can go to a session that already exists, use send_message_to_session instead. ' +
            'Call list_machines first and pass one of the returned machineIds; this tool does not accept a machine name. ' +
            'directory is required and is resolved on that machine. ' +
            'Omit projectId, model, effort, permissionMode, and title to take mobi\'s defaults. ' +
            'A title is only the new session\'s initial name — that session may rename itself once it knows what ' +
            'the work is, and its own name wins. ' +
            'The new session starts with no first message — it is an empty working context. ' +
            'Give it work with send_message_to_session. ' +
            'Creation is not instant: it launches a real Claude Code process on that machine. ' +
            'Failures are reported in plain language — the machine may be offline, the directory may not be creatable, ' +
            'or setup may have timed out.',
        title: 'Create Session',
        inputSchema: createSessionInputSchema,
        execute,
    }
}

export type CreateSessionTool = ReturnType<typeof createCreateSessionTool>

/** 会话场景组装入口（仅 remote 壳 mobiAppsServer 使用） */
export function createCreateSessionToolForSession(client: ApiSessionClient) {
    return createCreateSessionTool({
        createSession: (input) => client.createSessionForAgent(input),
    })
}
