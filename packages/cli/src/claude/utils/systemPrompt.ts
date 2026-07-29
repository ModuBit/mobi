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

import { trimIdent } from "@/utils/trimIdent";

/**
 * mobi 注入的基础 system prompt：要求模型调用 mobi 自有 MCP 工具管理会话标题。
 * 这段始终追加在 claude_code 默认 system prompt 之后。
 */
const BASE_SYSTEM_PROMPT = (() => trimIdent(`
    ALWAYS when you start a new chat - you must call a tool "mcp__mobi__change_title" to set a chat title. When you think chat title is not relevant anymore - call the tool again to change it. When chat name is too generic and you have a change to make it more specific - call the tool again. This title is needed to easily find the chat in the future. Help human.
`))();

/**
 * mobi 注入的基础 system prompt（仅 change_title 指令）。
 * 保留导出供需要纯 base 内容的场景使用；动态拼接请用 {@link buildAppendSystemPrompt}。
 */
export const systemPrompt = BASE_SYSTEM_PROMPT;

/**
 * 用户自定义 system prompt 配置片段。
 * customSystemPrompt 与 appendSystemPrompt 统一为 append 语义——
 * 二者都追加在 claude_code 默认 system prompt 之后，均不替换默认 prompt。
 */
export interface AppendSystemPromptConfig {
    /** 用户自定义指令（与 appendSystemPrompt 等价，均追加） */
    customSystemPrompt?: string;
    /** 用户追加指令 */
    appendSystemPrompt?: string;
}

/**
 * 构造追加到 claude_code 默认 system prompt 之后的内容。
 *
 * 统一 append 语义：customSystemPrompt 与 appendSystemPrompt 不再区分（历史上一为 replace、
 * 一为 append，replace 会整体丢掉 claude_code 默认 prompt，是脚枪），现都作为追加内容拼接。
 *
 * 拼接顺序：用户 custom → 用户 append → mobi base（change_title）。
 * 用户内容在前、mobi base 在后，保持历史顺序。
 */
export function buildAppendSystemPrompt(config: AppendSystemPromptConfig): string {
    return [config.customSystemPrompt, config.appendSystemPrompt, BASE_SYSTEM_PROMPT]
        .filter((part): part is string => Boolean(part))
        .join('\n\n');
}
