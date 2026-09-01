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

import { isObject } from '@mobi/shared'

/**
 * MCP elicitation 合成工具名（批次 C，spec D1）。
 * cli 侧 ELICITATION_TOOL_NAME 的 web 端字面量锚定——elicitation 借道 agentState.requests
 * 通道下发，类型上与普通审批条目不可区分，运行时靠该合成名判断；web 不跨包 import cli 常量
 * （既有 web/cli 解耦惯例），改 cli 常量时需同步此处。
 */
export const ELICITATION_TOOL_NAME = 'mcp_elicitation'

export function isElicitationToolName(toolName: string): boolean {
    return toolName === ELICITATION_TOOL_NAME
}

/** MCP elicitation requestedSchema 单字段（spec D4：仅 string/number/boolean/enum 四类） */
export type ElicitationFieldSchema = {
    type?: string
    title?: string
    description?: string
    enum?: (string | number | boolean)[]
}

/** MCP elicitation requestedSchema（spec D4：不支持的嵌套对象/数组由 cli 端 decline 兜底） */
export type ElicitationRequestedSchema = {
    type?: string
    properties?: Record<string, ElicitationFieldSchema>
    required?: string[]
}

/** elicitation pending 条目 arguments 携带的载荷（spec D1） */
export type ElicitationRequestPayload = {
    serverName: string
    message: string
    requestedSchema: ElicitationRequestedSchema | null
}

/**
 * 从 agentState.requests 条目的 arguments 提取 elicitation 载荷。
 * arguments 缺失/形态不符时返回 null（由调用方决定兜底：渲染层可据此 decline）。
 */
export function parseElicitationPayload(args: unknown): ElicitationRequestPayload | null {
    if (!isObject(args)) return null
    const serverName = typeof args.serverName === 'string' ? args.serverName : ''
    const message = typeof args.message === 'string' ? args.message : ''
    if (!serverName && !message) return null
    const schema = isObject(args.requestedSchema)
        ? (args.requestedSchema as ElicitationRequestedSchema)
        : null
    return { serverName, message, requestedSchema: schema }
}
