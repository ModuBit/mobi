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
 * fork 域纯函数（无 React / store 依赖，PC footer 与移动 Drawer 两入口共用）。
 * 判据语义见 fork-session spec §4.1：镜像 canRewindMessage（rewind.ts，只读复用其预览截断），
 * 差异点：仅 remote 会话、无 forkedFrom/forkFrom 的会话、无 nativeAckAt 要求
 * （fork 是 hub 侧纯动作，CLI 离线也可创建，假锚点由 hub forkSession 校验兜底）。
 */

import type { ForkedFromMetadata, ForkFromMetadata, NativeMessageMetadata } from '@mobi/shared'
import type { ChatBlock } from './types'
import { REWIND_COMMAND } from './presentation'
import { getUserPlainText } from './userContent'

export type { NativeMessageMetadata, ForkedFromMetadata, ForkFromMetadata }

/** 判据入参的最小消息形状（与 rewind.ts RewindableMessage 同构） */
export type ForkableMessage = {
    metadata?: NativeMessageMetadata | null
    /** 消息行权威序（DecryptedMessage.seq）；边界判据的比较操作数，缺失（快照流式行）时跳过边界判定 */
    seq?: number | null
}

/** 会话侧状态（running/backgroundTasks 来自 session DTO；forkedFrom/forkFrom 来自会话 metadata） */
export type ForkSessionState = {
    running: boolean
    backgroundTasks: number
    /** 仅 remote 会话可 fork（spec 非目标：local 会话 fork）；undefined = 不可判定（保守隐藏） */
    mode?: 'local' | 'remote'
    /** fork 持久溯源：存在 = 本会话已是分叉会话 → 禁止再 fork（spec §2） */
    forkedFrom?: ForkedFromMetadata | null
    /** fork 激活簿记：存在 = 待激活态 → 隐藏入口（spec §2） */
    forkFrom?: ForkFromMetadata | null
    /** 上下文边界指针（与 rewind 入口共用，spec §2）；缺失按 0 处理 = 保守放行 */
    contextBoundarySeq?: number
}

/**
 * fork 入口显隐判据（PC footer 操作组 / 移动长按 Drawer 共用，spec §4.1）。
 *
 * 体验层：误判方向只会隐藏入口（保守），放行侧由 hub forkSession
 * （锚点存在性 / 边界校验）把守——点确认后失败走 toast 归因。
 */
export function canForkMessage(
    message: ForkableMessage,
    sessionNativeSessionId: string | undefined | null,
    sessionState: ForkSessionState,
): boolean {
    // 仅 remote 会话可 fork（local 会话无 native transcript 链可锚定）
    if (sessionState.mode !== 'remote') return false
    // 在途工作（前台 running / 后台任务）期间禁止 fork
    if (sessionState.running || sessionState.backgroundTasks > 0) return false
    // 分叉会话禁止再 fork；待激活态（forkFrom 未清除）同样隐藏
    if (sessionState.forkedFrom != null || sessionState.forkFrom != null) return false
    // 会话侧 native session 未知（老数据 / 尚未上报）→ 保守不可
    if (!sessionNativeSessionId) return false
    // 消息无 native 锚点（分叉锚点 = agent 回复的 transcript uuid）→ 不可
    if (!message.metadata?.nativeId || !message.metadata.nativeSessionId) return false
    // 同一 transcript 链才可 fork（/clear 前旧行 nativeSessionId 不一致）
    if (message.metadata.nativeSessionId !== sessionNativeSessionId) return false
    // 边界判据（与 rewind 入口共用同一依据）：compact/clear 之前（seq ≤ 边界指针）不可 fork。
    // 指针缺失按 0 处理 = 存量会话未回填时保守放行；行 seq 缺失（快照流式行）无法比较 → 不因边界隐藏
    if (message.seq != null && message.seq <= (sessionState.contextBoundarySeq ?? 0)) return false
    return true
}

/** 块级 turn 起点判定（块空间镜像 turnBoundary.isTurnStart 的消息级语义）：
 *  user 信封（含 compact 总结消息）、context-cleared 事件、compact_boundary（compact 事件）。
 *  rewind 起点 synthetic 行（REWIND_COMMAND，不发送不落库）不是真实用户发言，不算新 turn。 */
function isTurnStartBlock(block: ChatBlock): boolean {
    if (block.kind === 'user-text') {
        return getUserPlainText(block.blocks).trim() !== REWIND_COMMAND
    }
    if (block.kind === 'compact-summary') return true
    if (block.kind === 'agent-event') {
        return block.event.type === 'context-cleared' || block.event.type === 'compact'
    }
    return false
}

/**
 * fork 入口落点集合（spec §4.2：仅挂「turn 的 result 落点」）——
 * 每 turn 最后一条 agent 文本块的 id 集合。在 chatBlocks（块空间）上按 turn 边界
 * 分组（isTurnStartBlock），turn 内尾随的工具块/事件（turn-result 等）不改变落点。
 */
export function collectForkTargetBlockIds(blocks: ChatBlock[]): Set<string> {
    const targets = new Set<string>()
    let lastAgentTextId: string | null = null
    const flush = () => {
        if (lastAgentTextId !== null) targets.add(lastAgentTextId)
        lastAgentTextId = null
    }
    for (const block of blocks) {
        if (isTurnStartBlock(block)) {
            flush()
            continue
        }
        if (block.kind === 'agent-text') lastAgentTextId = block.id
    }
    flush()
    return targets
}

/**
 * agent 文本块 → 消息行 key（供 metadata/seq 查表）：与 reducerTimeline 的 blockId
 * `${msg.localId || msg.id}:${idx}` 同构——localId 在场直接用（snapshot 与 full 共享），
 * 缺失时取 block.id 去掉 `:idx` 后缀（按最后一个 ':' 切，消息 id 本身可含 ':'）。
 */
export function agentBlockMessageKey(block: { id: string; localId: string | null }): string {
    if (block.localId) return block.localId
    const idx = block.id.lastIndexOf(':')
    return idx > 0 ? block.id.slice(0, idx) : block.id
}

/**
 * hub forkSession 失败 reason code → i18n key 判别（镜像 rewindRejectReasonKey）：
 * 已知 code 各归专用文案，其余（session-not-found / access-denied / 未知）笼统
 * unavailable——hub 的英文 error 串不直出给用户。
 */
export function forkRejectReasonKey(code: string | undefined):
    | 'chat.fork.anchorMissing'
    | 'chat.fork.beforeBoundary'
    | 'chat.fork.turnStartMissing'
    | 'chat.fork.parentNativeMissing'
    | 'chat.fork.unavailable' {
    switch (code) {
        case 'anchor-not-found': return 'chat.fork.anchorMissing'
        case 'anchor-before-boundary': return 'chat.fork.beforeBoundary'
        case 'turn-start-not-found': return 'chat.fork.turnStartMissing'
        case 'parent-native-missing': return 'chat.fork.parentNativeMissing'
        default: return 'chat.fork.unavailable'
    }
}

/**
 * fork 执行失败 catch 的 code 提取：优先取 HTTP 错误体里的 `code` 字段
 * （hub fork 路由透传的失败归因），非 HTTP 错误 / 无 code 返回 undefined
 * （文案层回退笼统提示）。裸读 err.message 只会拿到 axios 标准串，永远到不了文案映射。
 */
export function extractForkRejectCode(err: unknown): string | undefined {
    const body = (err as { response?: { data?: { code?: unknown } } } | null)?.response?.data
    if (typeof body?.code === 'string' && body.code.length > 0) return body.code
    return undefined
}
