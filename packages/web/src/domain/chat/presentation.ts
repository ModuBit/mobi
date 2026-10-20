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

import type { CrossSessionOrigin } from '@mobi/shared'
import type { ChatBlock } from './types'
import { getUserPlainText } from './userContent'

const CLEAR_COMMAND = '/clear'

/**
 * 跨会话入站来源的展示名（user 消息 meta.crossSession.from）。
 *
 * 收的已经是读出来的 `CrossSessionOrigin`（读侧唯一入口 `readCrossSessionOrigin`），
 * 这里只做一件 web 自己的事：**把空名字翻译成 null**——没名字不是「没有来源」，而是该走
 * `CrossSessionTag` 的通用文案分支。判据（这条消息该不该出标签）不在这里。
 *
 * 之所以收 origin 而不是 meta：调用点本来就要读 origin（判据要用它），再拿同一条 meta
 * 解析第二遍是白读，也让「谁负责解包」多出第二个答案。
 */
export function getCrossSessionFrom(origin: CrossSessionOrigin | null): string | null {
    return origin?.fromName || null
}

/** /compact 命令字面量，web 端判定压缩状态用 */
export const COMPACT_COMMAND = '/compact'

/**
 * compact 是否已完成（用于 isCompressing 解禁输入）。
 *
 * 三条完成信号：
 * - compact-summary block：成功路径，SDK 发 compact_boundary 后 CLI 回灌的压缩总结
 * - compact-completed event：CLI 在 compact 的 result 时（**无论成功失败**）发出的
 *   结构化事件。失败路径（如 "Not enough messages to compact."）不会产生 compact-summary，
 *   靠此事件兜底退出 compressing 状态，否则 sender 永久 disabled。
 * - compact event（compact_boundary）：**自动压缩的唯一终态信号**——compact-completed 只在
 *   手动 /compact（CLI isCompactCommand 置位）时发出，auto 压缩无此事件，boundary 到达即
 *   压缩完成。手动路径 boundary 先于 completed 到达，扫描从末尾向前先遇 completed，不冲突。
 */
export function isCompactCompletion(block: ChatBlock): boolean {
    if (block.kind === 'compact-summary') return true
    if (block.kind === 'agent-event' && block.event.type === 'compact-completed') return true
    return block.kind === 'agent-event' && block.event.type === 'compact'
}

/** compact-started：统一 started 信号（手动 specialCommand 与自动压缩双源同汇，CLI 幂等发出） */
export function isCompactStart(block: ChatBlock): boolean {
    return block.kind === 'agent-event' && block.event.type === 'compact-started'
}

/**
 * 推导某斜杠命令是否进行中：从末尾向前扫，先遇到完成标志 block → false（已完成），
 * 再遇到 started 标志（isStart，可选——事件驱动的命令生命周期）→ true，
 * 最后遇 user-text → 判断是否目标命令（sentinel 兜底，兼容无 started 事件的旧历史）；
 * 扫到首个 user-text 为止（不固定窗口，避免命令后被大量中间 block 推出窗口）。
 * /compact、/clear 等命令期间禁用输入。
 */
export function isCommandInProgress(
    chatBlocks: ChatBlock[],
    command: string,
    isCompletion: (block: ChatBlock) => boolean,
    isStart?: (block: ChatBlock) => boolean
): boolean {
    for (let i = chatBlocks.length - 1; i >= 0; i--) {
        const block = chatBlocks[i]
        if (isCompletion(block)) return false
        if (isStart?.(block)) return true
        if (block.kind === 'user-text') {
            return getUserPlainText(block.blocks).trim() === command
        }
    }
    return false
}

/** /clear 是否进行中（完成标志：context-cleared 事件） */
export function isClearInProgress(chatBlocks: ChatBlock[]): boolean {
    return isCommandInProgress(
        chatBlocks,
        CLEAR_COMMAND,
        (block) => block.kind === 'agent-event' && block.event.type === 'context-cleared'
    )
}

/**
 * rewind 命令标记：Web 确认 rewind 时本地插入的合成 user-text（不发送、不落库），
 * 仅作为 isCommandInProgress 的起点行（对齐 /clear 的「user-text 命令 → 完成事件」扫描模式）。
 * buildBubbleItems 跳过渲染该标记行。理论上与用户真实输入 /rewind 文本冲突——
 * rewinding 完成标记到达前该行会被隐藏一个 turn，可接受。
 */
export const REWIND_COMMAND = '/rewind'

/** rewind 完成标志：CLI 两段回报的终态事件（rewind-truncated 非终态——文件恢复仍在途，spec §4.5） */
export function isRewindCompletion(block: ChatBlock): boolean {
    return block.kind === 'agent-event' && block.event.type === 'rewind-completed'
}

/** rewind 是否进行中（起点：合成 REWIND_COMMAND 行；完成标志：rewind-completed 事件） */
export function isRewindInProgress(chatBlocks: ChatBlock[]): boolean {
    return isCommandInProgress(chatBlocks, REWIND_COMMAND, isRewindCompletion)
}
