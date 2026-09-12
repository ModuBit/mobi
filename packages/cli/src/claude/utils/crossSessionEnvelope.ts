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
 * 出站跨会话消息信封（纯函数）。
 *
 * 与 `inboundCrossSession.ts` 是同一份格式的两半：那一半是**读**（从 hook 观测到的 prompt
 * 里甄别 CC 原生 peer 消息、抽出正文与来源名），这一半是**写**（把 mobi 自发投递的消息
 * 包成 CC 与收件方都认得的样子）。格式由 Claude Code 定义，不是我们的协议——改一处必须
 * 同时改另一处，`crossSessionEnvelope.test.ts` 用 `parseInboundCrossSession` 交叉验证，
 * 两半漂移会被测出来。
 *
 * **为什么是首尾两个 text block**，而不是塞进某个 text block 里：带图消息的 blocks 是
 * `[text, image, text]` 形态，信封塞进其中一个 text block，图片就落到信封**外面**，
 * 收件方读到的就不是「一条被包住的消息」。首尾各一个则任何形态下信封都完整。
 *
 * 信封**纯粹是给模型看的文本提示**，不是协议：CC 不解析它，只把整条消息渲染成
 * 「用户在会话中途发来的新消息」。所以属性值按 XML 属性规则转义即可（见 escapeAttribute），
 * 不必考虑机器解析的往返保真。
 */

import type { UserContentBlock } from '@mobi/shared'

export interface CrossSessionEnvelope {
    /** 发送方会话名。会话未命名时为空串——身份由 fromSessionId 承担，不拿 id 冒充名字 */
    fromName: string
    /** 发送方会话 id（mobi 加的：CC 原生信封只有名字，无法反查会话、也无消息身份） */
    fromSessionId: string
    /** 本条消息的标识（Hub 预生成，与落库行的 localId 同值） */
    messageId: string
}

const ENVELOPE_TAG = 'cross-session-message'

/**
 * 属性值转义。
 *
 * 信封的读侧（`FROM_NAME_RE`）到第一个 `"` 就收尾、开标签到第一个 `>` 就结束，
 * 所以**会话名里出现这两个字符就会破坏标签本身**——后面两个属性跟着一起错位。
 * 会话名是人写的，不能假设它干净。
 *
 * `&` 必须**先**替换：放后面会把刚生成的 `&quot;` 里的 `&` 再转义一遍，变成 `&amp;quot;`。
 */
function escapeAttribute(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}

/**
 * 把已归一的 blocks 套进信封：首尾各插一个 text block，中间原样。
 *
 * 只加两个 block，**不改中间的任何 block**——`document` / `quote` / `image` 的既有换算
 * 规则照常在 `buildPromptFromBlocks` 里发生（与 Web 用户消息走的是同一个函数）。
 */
export function withCrossSessionEnvelope(
    blocks: readonly UserContentBlock[],
    envelope: CrossSessionEnvelope
): UserContentBlock[] {
    const openTag =
        `<${ENVELOPE_TAG} from-name="${escapeAttribute(envelope.fromName)}"` +
        ` from-session-id="${escapeAttribute(envelope.fromSessionId)}"` +
        ` message-id="${escapeAttribute(envelope.messageId)}">`

    return [
        { type: 'text', text: openTag },
        ...blocks,
        { type: 'text', text: `</${ENVELOPE_TAG}>` },
    ]
}
