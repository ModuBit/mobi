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
 * open_in_mobi 核心工具工厂（agent-apps A 类 UI 呈现，借鉴 codex open_in_codex）。
 *
 * 统一的"在 mobi 打开"工具：target 判别联合（file / terminal，后续增量扩展），
 * 经 CLI↔Hub socket 发 ui-command → Hub 按 Web 在线状态广播或静默，
 * 回执 { delivered } 是本工具的核心语义。仅挂 remote 壳（mobiAppsServer，
 * D1：local HTTP 壳不挂载——local 模式无 Hub/Web 链路）。
 *
 * 回执三分支（勿混淆）：
 * - delivered: true → 已在用户 Web 端打开（已广播语义，非"用户已看到"）
 * - delivered: false → 无 Web 在线，已忽略（调用成功非错误，平和反馈）
 * - emitWithAck reject → socket 断开/ack 超时，连接故障 ≠ 离线，isError: true
 */

import { z } from 'zod'
import type { ApiSessionClient } from '@/api/apiSession'
import type { UiCommandAction } from '@mobi/shared'

export const OPEN_IN_MOBI_TOOL_NAME = 'open_in_mobi' as const

export interface OpenInMobiToolDeps {
    /** 发送 UI 命令到 Hub（emitWithAck 等回执，见 ApiSessionClient.sendUiCommand） */
    sendUiCommand: (action: UiCommandAction) => Promise<{ delivered: boolean; reason?: string }>
}

/** MCP CallToolResult 的 text-only 子集（与 changeTitleTool 同型） */
export interface OpenInMobiToolResult {
    content: Array<{ type: 'text'; text: string }>
    isError: boolean
    [key: string]: unknown
}

export function createOpenInMobiTool(deps: OpenInMobiToolDeps) {
    // target 判别联合（协议见 shared OpenInMobiTargetSchema）；path 为绝对路径
    // （agent 本地视角 = CLI 所在机器，与 read-file 边界一致，受 0004 读边界约束）
    const openInMobiInputSchema = z.object({
        target: z.discriminatedUnion('type', [
            z.object({
                type: z.literal('file'),
                path: z.string().min(1).describe('Absolute path of the file to open (on the machine where this CLI runs)'),
                line: z.number().int().positive().optional().describe('Optional line number to scroll to'),
            }),
            z.object({
                type: z.literal('terminal'),
            }),
        ]),
    })

    function successText(payload: { type: 'file'; path: string; line?: number } | { type: 'terminal' }): string {
        return payload.type === 'file'
            ? `Opened ${payload.path}${payload.line != null ? ` (line ${payload.line})` : ''} in the user's mobi Web UI (file tab in the current session's sidebar).`
            : 'Opened a terminal tab in the user\'s mobi Web UI (current session\'s sidebar).'
    }

    async function execute(rawArgs: unknown): Promise<OpenInMobiToolResult> {
        const parsed = openInMobiInputSchema.safeParse(rawArgs);
        if (!parsed.success) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to open in mobi: invalid arguments (${parsed.error.message})`,
                    },
                ],
                isError: true,
            };
        }
        try {
            const answer = await deps.sendUiCommand({ action: 'open_in_mobi', payload: parsed.data.target });

            if (answer.delivered) {
                return {
                    content: [{ type: 'text', text: successText(parsed.data.target) }],
                    isError: false,
                };
            }

            // 离线静默（spec D5）：不报错、不排队，平和告知已忽略
            return {
                content: [
                    {
                        type: 'text',
                        text: `No Web client is currently online, so the request was ignored (not queued). Try again when the user is viewing their mobi Web UI.`,
                    },
                ],
                isError: false,
            };
        } catch (error) {
            // socket 断开/ack 超时：连接故障，不伪装成"已忽略"
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to send the UI command to mobi hub: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }

    return {
        name: OPEN_IN_MOBI_TOOL_NAME,
        // 描述含检索关键词（tool search defer 场景按描述命中）+ codex 同款"只开 UI"提示，
        // 防止模型误用它读取内容（read-file 才是读取通道）
        description:
            "Show something to the user in their mobi Web UI: open a workspace file (optionally at a line) or open a terminal, in a tab of the current session's sidebar. Use this after creating or editing an artifact when showing the result would help the user. This only opens the mobi UI; use file reading tools to inspect or interact with the content.",
        title: 'Open in Mobi',
        inputSchema: openInMobiInputSchema,
        execute,
    }
}

export type OpenInMobiTool = ReturnType<typeof createOpenInMobiTool>

/**
 * 会话场景的组装入口（仅 remote 壳 mobiAppsServer 使用）：
 * hub 通道 = ApiSessionClient.sendUiCommand（emitWithAck 回执）。
 */
export function createOpenInMobiToolForSession(client: ApiSessionClient) {
    return createOpenInMobiTool({
        sendUiCommand: (action) => client.sendUiCommand(action),
    })
}
