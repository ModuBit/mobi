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
 * 入站跨会话消息甄别（纯函数）。
 *
 * 背景：Claude Code 原生跨会话消息（/tmp/cc-socks UDS）绕过 Mobi wrapper 直接注入
 * claude 二进制，SDK 输出流不回显（replay-user-messages 仅覆盖 stdin 来源，已实证）。
 * 唯一官方观测点是 UserPromptSubmit hook（SDK Options.hooks 进程内回调）。
 *
 * 甄别规则（信封是落库的必要条件）：
 * - 信封缺失 → 非跨会话 peer 消息（自己的 stdin push 无信封不重复落库；
 *   任务通知/auto-continuation 等其他机器注入不展示）→ null
 * - source 字段已知且非 'system'（'sdk'/'user'/loop_wakeup 等）→ 恒忽略，
 *   覆盖「用户手打信封文本」的伪造边缘（0.3.250 起提供；文档注明灰度期可能缺省）
 * - source 缺省 + 信封存在 → 按跨会话处理（灰度期兜底）
 */

export interface InboundPromptInput {
    /** hook 收到的完整 prompt 原文（含外壳文案与信封） */
    prompt: string
    /** hook 输入的 source 字段；灰度期可能缺省 */
    source?: string
}

export interface InboundCrossSession {
    /** 信封内正文（trim 后）；信封缺 from-name 时为原文去外壳 */
    text: string
    /** 发送方 CLI 会话名；信封未携带时 null */
    fromName: string | null
}

// 开标签整体捕获（属性顺序/存在性不假设），from-name 再子提取——属性缺失时正文仍可降级提取
const ENVELOPE_RE = /<cross-session-message[^>]*>([\s\S]*?)<\/cross-session-message>/
const FROM_NAME_RE = /\bfrom-name="([^"]*)"/

export function parseInboundCrossSession(input: InboundPromptInput): InboundCrossSession | null {
    if (input.source !== undefined && input.source !== 'system') return null

    const match = ENVELOPE_RE.exec(input.prompt)
    if (!match) return null

    // 只切开标签搜索：正文可能引用别处的 from-name="..." 文本，
    // 在「开标签+正文」整体切片上搜索会误提取正文内容
    const openTagEnd = match.input.indexOf('>', match.index)
    const openTag = match.input.slice(match.index, openTagEnd + 1)
    const fromName = FROM_NAME_RE.exec(openTag)
    return {
        text: match[1].trim(),
        fromName: fromName ? fromName[1] : null,
    }
}
