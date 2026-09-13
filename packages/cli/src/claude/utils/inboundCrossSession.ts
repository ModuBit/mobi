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

// turn 来源三态、跨会话来源 concept、以及「这条是不是 mobi 投的」判据，单源都在 shared
// （与 web 的呈现判据、hub 的落库形状同一份）
import { isMobiDelivered } from '@mobi/shared'
import type { CrossSessionOrigin, TurnOrigin } from '@mobi/shared'

export interface InboundPromptInput {
    /** hook 收到的完整 prompt 原文（含外壳文案与信封） */
    prompt: string
    /** hook 输入的 source 字段；灰度期可能缺省 */
    source?: string
}

export interface InboundCrossSession {
    /** 信封内正文（trim 后）；信封缺 from-name 时为原文去外壳 */
    text: string
    /**
     * 发送方身份——与落库 meta 上的 `CrossSessionOrigin` **同一个 concept**。
     *
     * 信封的介质是文本（属性名 `from-name` / `from-session-id`，由 Claude Code 定义，不是
     * 我们的协议），读出来归一成同一个形状，这样「是不是 mobi 投递的」在信封与 meta 两条
     * 介质上是**同一句判据**（`isMobiDelivered`），不必各写一遍。
     *
     * 两个字段在信封侧的取值：`fromName` 缺属性时为空串（与 meta 侧同一约定——名字是给人
     * 看的，空名字不等于没有来源）；`fromSessionId` 对 CC 原生信封**恒为 null**——那是 mobi
     * 加的属性，原生信封只有 `from`（socket 地址）/ `from-name` / `from-mode` 三个。
     */
    origin: CrossSessionOrigin
}

export interface InboundTurn {
    kind: TurnOrigin
    /** 落库正文：peer=信封内正文；scheduled/loop=hook input.prompt 原文 */
    text: string
    /** peer 的来源身份；scheduled/loop 不是别的会话发来的，故为 null */
    origin: CrossSessionOrigin | null
}

/**
 * 按 hook input 的 source + 信封甄别入站 turn（spec 批次 D）。
 * - source='system' + 信封 + **无 from-session-id** → peer（CC 原生跨会话消息）
 * - source='schedule_wakeup' → scheduled（CronCreate/routine 触发）
 * - source='loop_wakeup' → loop（/loop 唤醒）
 * - 其他（user/sdk/poll_event/无信封的 system）→ null，走常规用户消息流，不落库
 *
 * source 灰度期可能缺省（0.3.250 起）：缺省时仅信封存在按 peer 兜底（与 parseInboundCrossSession 一致）。
 */
export function classifyInboundTurn(input: InboundPromptInput): InboundTurn | null {
    // scheduled / loop：source 显式标识，不依赖信封，也没有来源会话
    if (input.source === 'schedule_wakeup') {
        return { kind: 'scheduled', text: input.prompt.trim(), origin: null }
    }
    if (input.source === 'loop_wakeup') {
        return { kind: 'loop', text: input.prompt.trim(), origin: null }
    }

    // peer：source=system（或灰度缺省）+ 信封
    if (input.source !== undefined && input.source !== 'system') return null
    const peer = parseInboundCrossSession(input)
    if (!peer) return null

    // mobi 自发投递的信封带 from-session-id，**不由本观测路径落库**：那条消息的投递路径
    // 自己负责落库（Hub 在 RPC 投递成功后写行），观测路径再记一次会在目标会话里留下
    // 两行一模一样的消息。
    //
    // 2026-09-12 实测（本特性的 E2E）：CLI 经 stdin 推入一封带信封的消息后，CC 的
    // UserPromptSubmit hook 以 system 源报了同一个信封，于是目标会话里出现两行——
    // 一行是投递路径写的（带 crossSession + fromSessionId、数组形态 blocks），
    // 一行是本路径写的（带 turnOrigin: 'peer'、单对象形态），相隔 15ms。
    // 这与 spec D34「hook 的 source 是 sdk，天然不会重复落库」的预期不符：source 是 system。
    //
    // 判据与另两个出口共用 `isMobiDelivered`（见该函数的说明）——信封读侧已经归一成
    // 与 meta 同一形状的 origin，所以这里问的正是与 backfill 守卫同一句话
    if (isMobiDelivered(peer.origin)) return null

    return { kind: 'peer', text: peer.text, origin: peer.origin }
}

// 开标签整体捕获（属性顺序/存在性不假设），from-name / from-session-id 再子提取——
// 属性缺失时正文仍可降级提取
const ENVELOPE_RE = /<cross-session-message[^>]*>([\s\S]*?)<\/cross-session-message>/
const FROM_NAME_RE = /\bfrom-name="([^"]*)"/
const FROM_SESSION_ID_RE = /\bfrom-session-id="([^"]*)"/

export function parseInboundCrossSession(input: InboundPromptInput): InboundCrossSession | null {
    if (input.source !== undefined && input.source !== 'system') return null

    const match = ENVELOPE_RE.exec(input.prompt)
    if (!match) return null

    // 只切开标签搜索：正文可能引用别处的 from-name="..." 文本，
    // 在「开标签+正文」整体切片上搜索会误提取正文内容
    const openTagEnd = match.input.indexOf('>', match.index)
    const openTag = match.input.slice(match.index, openTagEnd + 1)
    const fromName = FROM_NAME_RE.exec(openTag)
    const fromSessionId = FROM_SESSION_ID_RE.exec(openTag)
    return {
        text: match[1].trim(),
        origin: {
            // 缺属性或属性为空串 → 空串（与 meta 侧同一约定：空名字不等于没有来源）
            fromName: fromName ? fromName[1] : '',
            // CC 原生信封没有这个属性（它是 mobi 加的），故原生 peer 消息恒为 null
            fromSessionId: fromSessionId ? fromSessionId[1] : null
        }
    }
}
