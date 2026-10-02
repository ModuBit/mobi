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
 * mobi MCP 工具的 text-only 结果构造助手。
 * MCP CallToolResult 的 text-only 子集（两种 transport 均接受此形态；索引签名兼容
 * MCP SDK 的宽泛结果类型），消除各工具工厂里重复的结果类型与样板构造。
 */

export interface MobiToolTextResult {
    content: Array<{ type: 'text'; text: string }>
    isError: boolean
    [key: string]: unknown
}

export function textResult(text: string): MobiToolTextResult {
    return { content: [{ type: 'text', text }], isError: false }
}

export function errorTextResult(prefix: string, error: unknown): MobiToolTextResult {
    return {
        content: [{ type: 'text', text: `${prefix}: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
    }
}
