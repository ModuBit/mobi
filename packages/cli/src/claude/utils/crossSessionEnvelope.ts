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
 * 「用户在会话中途发来的新消息」。所以属性值按 XML 属性规则转义即可（见 escapeMarkup），
 * 不必考虑机器解析的往返保真。
 *
 * 除信封外，本模块还在**闭标签之后**追加一段 `<system-reminder>`（回信提示，见
 * replyReminder）——只进推给 CC 的那一份，落库那一份里没有它。
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
 * 标记与文本转义。
 *
 * 信封的读侧（`FROM_NAME_RE`）到第一个 `"` 就收尾、开标签到第一个 `>` 就结束，
 * 所以**会话名里出现这两个字符就会破坏标签本身**——后面两个属性跟着一起错位。
 * 会话名是人写的，不能假设它干净。插进提醒块的名字同理：不转义的话，名字里写
 * `</system-reminder>` 就能从提醒块里「逃出来」，后面的内容成了块外文本。
 *
 * `&` 必须**先**替换：放后面会把刚生成的 `&quot;` 里的 `&` 再转义一遍，变成 `&amp;quot;`。
 */
function escapeMarkup(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}

/** 收件方回信该用的工具名（与 sendMessageTool 的 SEND_MESSAGE_TOOL_NAME 同值，注册在 mobi-apps server 上） */
const REPLY_TOOL = 'send_message_to_session'

/**
 * 回信提示（2026-09-12 E2E 实测的痛点）。
 *
 * 收件方 agent 看到信封后要回答「我该用哪个工具回」，而它手上还有一个 Claude Code 原生的
 * `SendMessage`（按 **agent 名**寻址）。实测不点名工具时它会先试原生那个、把信封里的会话
 * **标题**当 agent 名去寻址，连试三次全失败（`No agent named '…' is reachable`），那条本该
 * 回的信就没了。这不是模型笨——两条路长得太像，而只有一条通。
 *
 * 所以 mobi 自己把话说清：用哪个工具、回给谁（用会话 id，不用标题）、以及标题为什么不行。
 * 放在**闭标签之后**：它不是发送方的话；`inboundCrossSession` 的 `ENVELOPE_RE` 只取首尾
 * 标签之间的内容，块外文本不进正文提取。
 *
 * 包在 `<system-reminder>` 里是照 harness 的既有写法（CC 自己就是这么注入上下文的）：
 * 模型一眼能分出「这是系统加的说明」和「这是对面那个人说的话」，免得误以为发送方在给自己
 * 下指示。mobi 不解析这个标签，也不依赖它——它只是给模型看的。
 */
function replyReminder(envelope: CrossSessionEnvelope): string {
    return (
        '<system-reminder>\n' +
        'This message was delivered by mobi on behalf of another session. To reply, call the mobi tool ' +
        `"${REPLY_TOOL}" with targets: ["${escapeMarkup(envelope.fromSessionId)}"]. ` +
        `The name "${escapeMarkup(envelope.fromName)}" is only that session's display title — it is not an agent name, ` +
        'and other messaging tools cannot reach it by that name.\n' +
        '</system-reminder>'
    )
}

/**
 * 把已归一的 blocks 套进信封：首尾各插一个 text block，中间原样，闭标签后再追一条回信提示。
 *
 * 只加三个 text block，**不改中间的任何 block**——`document` / `quote` / `image` 的既有换算
 * 规则照常在 `buildPromptFromBlocks` 里发生（与 Web 用户消息走的是同一个函数）。
 */
export function withCrossSessionEnvelope(
    blocks: readonly UserContentBlock[],
    envelope: CrossSessionEnvelope
): UserContentBlock[] {
    const openTag =
        `<${ENVELOPE_TAG} from-name="${escapeMarkup(envelope.fromName)}"` +
        ` from-session-id="${escapeMarkup(envelope.fromSessionId)}"` +
        ` message-id="${escapeMarkup(envelope.messageId)}">`

    return [
        { type: 'text', text: openTag },
        ...blocks,
        { type: 'text', text: `</${ENVELOPE_TAG}>` },
        { type: 'text', text: replyReminder(envelope) },
    ]
}
