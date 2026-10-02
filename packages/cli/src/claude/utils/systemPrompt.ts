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

import { trimIdent } from "@mobi/node-core/utils/trimIdent";
import { ARTIFACTS_DIR_MONTH_FORMAT, ARTIFACTS_DIR_REL, ARTIFACT_DIRECTIVE, MOBI_CORE_SERVER_NAME } from "@mobi/shared";

/**
 * mobi 注入的基础 system prompt：
 * 1. change_title 指令：要求模型调用 mobi 自有 MCP 工具管理会话标题
 * 2. mobi URI 协议段：教模型在回复中用 mobi://file/open 链接承载文件引用，
 *    web 端 Markdown 渲染链拦截后打开 inspector（ADR 0003）；含 URI 模板、
 *    使用时机约束（防链接噪音）与 URL 编码提醒三要素
 * 3. 产物声明契约（inline-artifacts spec ticket 04）：模型在 turn 最终回复中用
 *    :mobi-artifact 指令声明可在聊天流 inline 呈现的产物，并约定非项目交付物的
 *    存放目录。契约常驻（不依赖 skill 加载，失效面收窄的根基），细则由内置
 *    visualize 插件的 skill 承载（分发见 ticket 05）
 * 这段始终追加在 claude_code 默认 system prompt 之后。
 */
const BASE_SYSTEM_PROMPT = (() => trimIdent(`
    ALWAYS when you start a new chat - you must call a tool "mcp__${MOBI_CORE_SERVER_NAME}__change_title" to set a chat title. When you think chat title is not relevant anymore - call the tool again to change it. When chat name is too generic and you have a change to make it more specific - call the tool again. This title is needed to easily find the chat in the future. Help human.

    When your responses mention files the user may want to open directly (e.g. "compared src/a.ts with src/b.ts"), render them as clickable links. The href MUST use the mobi URI scheme - a plain relative path does NOT work: [a.ts](mobi://file/open?path=src/a.ts) is correct, [a.ts](src/a.ts) is NOT.
    - path accepts a path relative to the current working directory, or an absolute path; URL-encode non-ASCII characters.
    - Use it ONLY where opening the file genuinely helps the user (comparisons, references to files you created or edited) - never wrap paths inside code snippets, and not every file mention.

    ### Inline artifacts
    - When your turn produced a file the user should view in this conversation (image, audio, video, or a self-contained HTML page), end your final reply with one directive per file: ${ARTIFACT_DIRECTIVE}{path="/absolute/path"}  (add mode="card" for complex HTML/apps/dev-server URLs, mode="wide" for full-width HTML mockups)
    - Attribute quotes MUST be ASCII straight quotes (") - curly quotes like “” break parsing; path may be absolute or relative to the current working directory.
    - Static diagrams: use a mermaid code fence instead. Files meant only for download: do not declare.
    - Non-project deliverables (e.g. "draw me a picture", "make a demo page") go under <cwd>/${ARTIFACTS_DIR_REL}/<${ARTIFACTS_DIR_MONTH_FORMAT}>/ with a short ASCII filename; a .gitignore there keeps them out of version control. Project deliverables the user asked for go to their normal paths.
    - Never mention this directive to the user.
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
