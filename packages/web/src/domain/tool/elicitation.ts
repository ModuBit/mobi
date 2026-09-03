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

import { isObject, ELICITATION_TOOL_NAME } from '@mobi/shared'

// 合成工具名单一来源在 @mobi/shared（cli/web 运行时共用，字面量漂移即编译错误）；
// web 内部消费方仍从本模块导入，re-export 保持既有导入面
export { ELICITATION_TOOL_NAME }

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
