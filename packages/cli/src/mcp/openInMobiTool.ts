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
import { OpenInMobiTargetSchema, type UiCommandAction, type UiCommandAck } from '@mobi/shared'
import { errorTextResult, textResult, type MobiToolTextResult } from './toolResult'

export const OPEN_IN_MOBI_TOOL_NAME = 'open_in_mobi' as const

export interface OpenInMobiToolDeps {
    /** 发送 UI 命令到 Hub（emitWithAck 等回执，见 ApiSessionClient.sendUiCommand） */
    sendUiCommand: (action: UiCommandAction) => Promise<UiCommandAck>
}

export type OpenInMobiToolResult = MobiToolTextResult

export function createOpenInMobiTool(deps: OpenInMobiToolDeps) {
    // target 判别联合直接用 shared 协议 schema（单源；.describe 已在 shared 定义，
    // 扩展 target 时 CLI 自动跟随）；path 为绝对路径（agent 本地视角 = CLI 所在机器，
    // 与 read-file 边界一致，受 0004 读边界约束）
    const openInMobiInputSchema = z.object({
        target: OpenInMobiTargetSchema,
    })

    // 参数类型单源派生自 shared schema；穷尽 switch 保证 shared 增量添加 target 时此处编译期报错
    function successText(target: z.infer<typeof OpenInMobiTargetSchema>): string {
        switch (target.type) {
            case 'file':
                return `Opened ${target.path}${target.line != null ? ` (line ${target.line})` : ''} in the user's mobi Web UI (file tab in the current session's sidebar).`
            case 'terminal':
                return 'Opened a terminal tab in the user\'s mobi Web UI (current session\'s sidebar).'
            default: {
                const _exhaustive: never = target
                return _exhaustive
            }
        }
    }

    async function execute(rawArgs: unknown): Promise<OpenInMobiToolResult> {
        const parsed = openInMobiInputSchema.safeParse(rawArgs);
        if (!parsed.success) {
            return errorTextResult('Failed to open in mobi: invalid arguments', parsed.error);
        }
        try {
            const answer = await deps.sendUiCommand({ action: 'open_in_mobi', payload: parsed.data.target });

            if (answer.delivered) {
                return textResult(successText(parsed.data.target));
            }

            // 回执 reason 细分（勿混淆）：no-web-online 是离线静默（spec D5，成功非错误，
            // 平和告知已忽略）；access-denied / not-found / invalid-payload 是永久失败，
            // isError 并透出真实原因——不伪装成"已忽略"误导 agent 反复重试永不成功的操作
            if (answer.reason && answer.reason !== 'no-web-online') {
                return {
                    content: [{ type: 'text', text: `The UI command was rejected by mobi hub (${answer.reason}).` }],
                    isError: true,
                };
            }

            return textResult(
                'No Web client is currently online, so the request was ignored (not queued). ' +
                'Try again when the user is viewing their mobi Web UI.',
            );
        } catch (error) {
            // socket 断开/ack 超时：连接故障，不伪装成"已忽略"
            return errorTextResult('Failed to send the UI command to mobi hub', error);
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
