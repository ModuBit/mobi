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
 * 入站消息落在 meta 上的来源标注（两个维度 + 它们的读写）。
 *
 * **维度一「谁发的」**——跨会话消息的发送方身份（`CrossSessionOrigin`）。领域上这是一个
 * 概念、两条来源（`packages/hub/CONTEXT.md`）：CC 原生 peer（CLI 经 UserPromptSubmit
 * hook 观测落库）与 mobi 自发投递（agent 经 send_message_to_session）。两者的差别只有
 * 一处——**有没有 fromSessionId**。本模块把它写成 `fromSessionId: string | null`，让
 * 「没有」是个明确的取值，而不是靠字段缺失去暗示。
 *
 * **维度二「这条 turn 是什么触发的」**——`TurnOrigin`（peer / scheduled / loop）。与维度一
 * **不同轴**：scheduled 与 loop 压根不是跨会话消息，所以它不并进 `CrossSessionOrigin`。
 * 两者同处一个文件，是因为**读写两侧总是同时需要**：CLI 在同一处 meta 上一起写，Web 在同一个
 * 气泡 header 上一起读（见 `web/domain/chat/presentation.ts`）。
 *
 * **为什么这个文件存在**（2026-09-13 架构评审候选 #1）：此前这组形状被七处各描述一遍——
 * RPC 载荷把它平铺、信封另立一个同名类型、落库载荷把 id 包进 `crossSession` 内、meta 又提到
 * 顶层、web 侧干脆没有类型靠 `as` 强转，另有一处读裸真值。同一个身份一路被改写，加一个字段
 * 要跨四个包同步，漏一处 zod 就静默剥键。此处把**形状**与**读写**各收成一处。
 *
 * 边界：信封（推给 CC 的那份）的属性名 `from-name` / `from-session-id` 由 Claude Code 定义，
 * 不是我们的协议（见 `cli/claude/utils/crossSessionEnvelope.ts`），故不在此收编；本模块只管
 * **我们自己的** meta 形状。落库 meta 的 JSON 形状也与存量行逐字一致，不随本模块改名。
 */

import { z } from 'zod'
import { isObject } from './utils'

/**
 * 跨会话消息的发送方身份。两条来源共用一个形状，差别只在 `fromSessionId`。
 */
export interface CrossSessionOrigin {
    /**
     * 发送方会话名（给人看的标签，也是信封 from-name 的来源）。
     *
     * 会话未命名时为空串——**不拿 id 冒充名字**：身份由 `fromSessionId` 承担，
     * 这个字段只负责「人怎么称呼它」。
     */
    fromName: string
    /**
     * 发送方会话 id。**只有 mobi 自发投递有**：CC 原生 peer 的信封只有
     * `from`（socket 地址）/ `from-name` / `from-mode` 三个属性，反查不到会话、也没有消息
     * 身份，故此处为 `null`。
     *
     * 这个字段同时就是「这条是 mobi 投递的」的判据（见 `isMobiSentCrossSession`）。
     */
    fromSessionId: string | null
}

/** 入站 turn 来源：peer=跨会话消息 / scheduled=定时任务 / loop=/loop 唤醒 */
export const TURN_ORIGINS = ['peer', 'scheduled', 'loop'] as const
export type TurnOrigin = (typeof TURN_ORIGINS)[number]

/**
 * 落库 meta 上的跨会话标注——`toCrossSessionMeta` 的产出，也是读取侧认的形状。
 *
 * 字段摆位（`from` 在 `crossSession` 内、`fromSessionId` 在 meta 顶层）是**既有存量数据的
 * 形状**，不能改：DB 里已有行按它落库。
 */
export const CrossSessionMetaSchema = z.object({
    crossSession: z.object({ from: z.string() }),
    fromSessionId: z.string().optional()
})
export type CrossSessionMeta = z.infer<typeof CrossSessionMetaSchema>

/** 入站 turn 来源的合法值 schema（写入侧校验用，取值来源即 `TURN_ORIGINS`） */
export const TurnOriginSchema = z.enum(TURN_ORIGINS)

/**
 * 从 meta 读取跨会话来源。`null` = 不是跨会话消息（普通用户消息 / agent 消息）。
 *
 * 入参是 **meta** 而不是整个 content：CLI 侧手上是外层 message（meta 在 content 里），
 * Web 侧手上直接就是 meta（`block.meta` / `msg.meta`），收在 meta 这一层两边都能直接用，
 * 不必各自往下钻。
 *
 * 判据只有一条：**`crossSession` 是个对象**——不是「from 非空」。发送方还没名字
 * （change_title 之前的新会话）时 from 是空串，但那依然是一条跨会话消息，标签该走
 * `CrossSessionTag` 的 from=null 通用文案分支。拿「from 非空」当判据会让这类消息的标签
 * 整条消失，看起来像用户自己发的（2026-09-12 实测修过一次）。
 *
 * 字段读得宽松（非字符串一律归一为「没有」），因为这是**消费侧**：形状不对时降级成
 * 「无从判定来源」，而不是抛错——一条渲染不出来的消息比少个标签更糟。
 */
export function readCrossSessionOrigin(meta: unknown): CrossSessionOrigin | null {
    if (!isObject(meta)) return null
    const crossSession = (meta as { crossSession?: unknown }).crossSession
    if (!isObject(crossSession)) return null

    const from = (crossSession as { from?: unknown }).from
    const fromSessionId = (meta as { fromSessionId?: unknown }).fromSessionId

    return {
        fromName: typeof from === 'string' ? from : '',
        // 空串等同「没有」：两条来源的判据是「这个键带身份」，空串带不了
        fromSessionId:
            typeof fromSessionId === 'string' && fromSessionId.length > 0 ? fromSessionId : null
    }
}

/**
 * 这条消息是不是 **mobi 自发投递**的跨会话消息。
 *
 * 收的是外层 message 的 content 而不是 meta，因为唯一调用点守的就是**落库行**
 * （`cli/api/apiSession.ts` 的 backfill 去重）——那里手上正是 content。语义上它读的仍是
 * 同一个来源标注，只是替调用方把 meta 取出来。
 *
 * **消费方必须跳过这类消息的「落库行 → SDK」方向**：mobi 自发消息的投递通道是
 * push-agent-message RPC，落库行只供 Web 展示与历史回放。重连后的 backfill 会读到这一行，
 * 不跳过就会被第二次推进 SDK（`handleIncomingMessage` 只看内容形状，不看 meta）。
 */
export function isMobiSentCrossSession(content: unknown): boolean {
    const meta = isObject(content) ? (content as { meta?: unknown }).meta : undefined
    const origin = readCrossSessionOrigin(meta)
    return origin !== null && origin.fromSessionId !== null
}

/**
 * 从 meta 读取入站 turn 来源。缺失或非法值一律 `null`（UI 回退 peer 行为，兼容旧消息）。
 */
export function readTurnOrigin(meta: unknown): TurnOrigin | null {
    if (!isObject(meta)) return null
    const raw = (meta as { turnOrigin?: unknown }).turnOrigin
    return typeof raw === 'string' && (TURN_ORIGINS as readonly string[]).includes(raw)
        ? (raw as TurnOrigin)
        : null
}

/**
 * 落库 meta 的写入投影：把来源身份摊成 meta 上那两个键的**唯一一处**。
 *
 * `fromSessionId` 为 null 时不写这个键——与 CC 原生 peer 行保持同形（那种行本来就没有它）。
 * 反过来，`crossSession` **恒写入**（哪怕名字是空串）：Web 的 compact 判定靠「有没有
 * crossSession」排除跨会话消息，键缺失会让降级消息被误渲染成 compact-summary。
 */
export function toCrossSessionMeta(origin: CrossSessionOrigin): CrossSessionMeta {
    return {
        crossSession: { from: origin.fromName },
        ...(origin.fromSessionId !== null ? { fromSessionId: origin.fromSessionId } : {})
    }
}
