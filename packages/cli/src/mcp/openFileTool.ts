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
 * open_file 核心工具工厂（agent-apps 首切片，A 类 UI 呈现）。
 *
 * agent 调用后经 CLI↔Hub socket 发 ui-command → Hub 按 Web 在线状态广播或静默，
 * 回执 { delivered } 是本工具的核心语义。仅挂 remote 壳（mobiSdkMcpServer，
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

export const OPEN_FILE_TOOL_NAME = 'open_file' as const

export interface OpenFileToolDeps {
    /** 发送 UI 命令到 Hub（emitWithAck 等回执，见 ApiSessionClient.sendUiCommand） */
    sendUiCommand: (action: UiCommandAction) => Promise<{ delivered: boolean; reason?: string }>
}

/** MCP CallToolResult 的 text-only 子集（与 changeTitleTool 同型） */
export interface OpenFileToolResult {
    content: Array<{ type: 'text'; text: string }>
    isError: boolean
    [key: string]: unknown
}

export function createOpenFileTool(deps: OpenFileToolDeps) {
    // 入参为绝对路径（agent 本地视角 = CLI 所在机器，与 read-file 边界一致，受 0004 读边界约束）
    const openFileInputSchema = z.object({
        path: z.string().min(1).describe('Absolute path of the file to open (on the machine where this CLI runs)'),
    })

    async function execute(rawArgs: unknown): Promise<OpenFileToolResult> {
        const parsed = openFileInputSchema.safeParse(rawArgs);
        if (!parsed.success) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to open file: invalid arguments (${parsed.error.message})`,
                    },
                ],
                isError: true,
            };
        }
        const path = parsed.data.path;
        try {
            const answer = await deps.sendUiCommand({ action: 'open_file', path });

            if (answer.delivered) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Opened ${path} in the user's mobi Web UI (file tab in the current session's sidebar).`,
                        },
                    ],
                    isError: false,
                };
            }

            // 离线静默（spec D5）：不报错、不排队，平和告知已忽略
            return {
                content: [
                    {
                        type: 'text',
                        text: `No Web client is currently online, so the request to open ${path} was ignored (not queued). Try again when the user is viewing their mobi Web UI.`,
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
                        text: `Failed to send open-file command to mobi hub: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }

    return {
        name: OPEN_FILE_TOOL_NAME,
        // 描述含检索关键词（tool search defer 场景按描述命中）：open file / preview / sidebar / show the user
        description:
            "Open a file in the user's mobi Web UI so they can view it. Use this to show the user a file, preview its contents in a sidebar tab of the current session, or display a file while discussing it.",
        title: 'Open File in Web UI',
        inputSchema: openFileInputSchema,
        execute,
    }
}

export type OpenFileTool = ReturnType<typeof createOpenFileTool>

/**
 * 会话场景的组装入口（仅 remote 壳 mobiSdkMcpServer 使用）：
 * hub 通道 = ApiSessionClient.sendUiCommand（emitWithAck 回执）。
 */
export function createOpenFileToolForSession(client: ApiSessionClient) {
    return createOpenFileTool({
        sendUiCommand: (action) => client.sendUiCommand(action),
    })
}
