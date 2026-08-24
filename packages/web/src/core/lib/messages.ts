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

import { isLifecycleAhead } from '@mobi/shared'
import type { DecryptedMessage } from '@/core/data/api/types'
import { uuid } from './uuid'

/**
 * 生成客户端唯一 ID
 */
export function makeClientSideId(prefix: string): string {
    return `${prefix}-${uuid()}`
}

/**
 * 判断是否为用户消息
 */
export function isUserMessage(msg: DecryptedMessage): boolean {
    const content = msg.content
    if (content && typeof content === 'object' && 'role' in content) {
        return (content as { role: string }).role === 'user'
    }
    return false
}

/**
 * 判断是否为乐观更新消息
 */
function isOptimisticMessage(msg: DecryptedMessage): boolean {
    return Boolean(msg.localId && msg.id === msg.localId)
}

/**
 * 是否为「仍在排队、未被 agent 消费」的消息（悬浮条展示、从线程剔除的判断依据）。
 *
 * 只读显式 `lifecycle==='queued'`——这是 Hub 写入时用 denylist 谓词裁决的单一结果，
 * Web 不再反推来源/时间戳。乐观消息（尚未收到服务端 echo）由 useSendMessage 直接置
 * lifecycle='queued'。
 * status='sending'（非 running 发送，在途开新 turn）/ status='failed' 排除。
 */
export function isQueuedInMobi(msg: DecryptedMessage): boolean {
    if (msg.status === 'failed' || msg.status === 'sending') return false
    return msg.lifecycle === 'queued'
}

/**
 * 消息比较函数，用于排序。
 *
 * 主排序键 = positionAt（与 hub 侧 position_at 排序语义对齐）：排队消息被消费时
 * positionAt 跳到消费时刻，保证「运行中消费的消息排在 turn 之后」。seq 只是落库自增序号，
 * 不随排队消费跳变——若以 seq 为主键，运行中发消息时用户消息会卡在上一轮 assistant 输出中间
 *（乐观发送时刻早于 turn 结束时落库的后续 assistant 消息）。positionAt 缺失（如 snapshot）回退 seq。
 */
function compareMessages(a: DecryptedMessage, b: DecryptedMessage): number {
    const aPos = typeof a.positionAt === 'number' ? a.positionAt : null
    const bPos = typeof b.positionAt === 'number' ? b.positionAt : null

    if (aPos !== null && bPos !== null && aPos !== bPos) {
        return aPos - bPos
    }

    const aSeq = typeof a.seq === 'number' ? a.seq : null
    const bSeq = typeof b.seq === 'number' ? b.seq : null

    if (aSeq !== null && bSeq !== null && aSeq !== bSeq) {
        return aSeq - bSeq
    }

    if (a.createdAt !== b.createdAt) {
        return a.createdAt - b.createdAt
    }
    return a.id.localeCompare(b.id)
}

/**
 * 按排序锚点排序消息（positionAt → seq → createdAt → id），返回新数组。
 * 供排队消息消费（positionAt 跳变）后重排，恢复 messages 数组有序——这是唯一打破
 * 「到达顺序 = 有序」的场景（正常运行中 positionAt 单调递增，append 即有序）。
 */
export function sortMessages(messages: DecryptedMessage[]): DecryptedMessage[] {
    return [...messages].sort(compareMessages)
}

/**
 * 合并消息列表
 * 处理乐观更新消息的去重和合并
 */
export function mergeMessages(existing: DecryptedMessage[], incoming: DecryptedMessage[]): DecryptedMessage[] {
    if (existing.length === 0) {
        return [...incoming].sort(compareMessages)
    }
    if (incoming.length === 0) {
        return [...existing].sort(compareMessages)
    }

    const byId = new Map<string, DecryptedMessage>()
    for (const msg of existing) {
        byId.set(msg.id, msg)
    }
    for (const msg of incoming) {
        let row = msg
        // (1) 服务端 echo 带有 localId：从乐观消息迁移 status/lifecycleAt
        // 避免排队中的乐观气泡被服务端确认后丢失排队态
        if (row.localId) {
            const optimistic = byId.get(row.localId)
            if (optimistic && isOptimisticMessage(optimistic)) {
                row = {
                    ...row,
                    status: optimistic.status ?? row.status,
                    lifecycleAt: optimistic.lifecycleAt ?? row.lifecycleAt,
                }
            }
        }
        // (2) 不让 incoming 用 null/undefined lifecycleAt 覆盖已有的非 null lifecycleAt
        // 防止陈旧的服务端 echo 回退已确认的 pushed 状态
        // (2b) lifecycle 单调防护（rank 泛化）：prev 已推进而 incoming 回退（rank 更低或同 rank 异终态）
        // 时保留 prev 的 lifecycle + lifecycleAt——对齐 shared 契约「转换单调前进」。陈旧 echo/
        // in-flight fetch 旧响应晚到均适用。incoming 更靠后则正常接受。
        // 时间戳判定：仅当 prev 不晚于 incoming 才视为陈旧回退（incoming 更晚 = 更新的权威状态）
        const prev = byId.get(row.id)
        if (prev && prev.lifecycleAt != null && row.lifecycleAt == null) {
            row = { ...row, lifecycleAt: prev.lifecycleAt }
        }
        if (
            prev && prev.lifecycle && row.lifecycle
            && prev.lifecycle !== row.lifecycle
            && !isLifecycleAhead(prev.lifecycle, row.lifecycle)
            && (prev.lifecycleAt ?? 0) >= (row.lifecycleAt ?? 0)
        ) {
            row = { ...row, lifecycle: prev.lifecycle, lifecycleAt: prev.lifecycleAt }
        }
        byId.set(row.id, row)
    }

    let merged = Array.from(byId.values())

    const incomingStoredLocalIds = new Set<string>()
    for (const msg of incoming) {
        if (msg.localId && !isOptimisticMessage(msg)) {
            incomingStoredLocalIds.add(msg.localId)
        }
    }

    // 如果收到带有 localId 的已存储消息，删除相同 localId 的乐观更新消息
    if (incomingStoredLocalIds.size > 0) {
        merged = merged.filter((msg) => {
            if (!msg.localId || !incomingStoredLocalIds.has(msg.localId)) {
                return true
            }
            return !isOptimisticMessage(msg)
        })
    }

    // 后备处理：如果乐观更新消息标记为已发送但没有收到 localId 回显，
    // 当服务器用户消息出现且时间接近时，删除该乐观更新消息
    const optimisticMessages = merged.filter((m) => isOptimisticMessage(m))
    const nonOptimisticMessages = merged.filter((m) => !isOptimisticMessage(m))
    const result: DecryptedMessage[] = [...nonOptimisticMessages]

    for (const optimistic of optimisticMessages) {
        if (optimistic.status === 'sent') {
            const hasServerUserMessage = nonOptimisticMessages.some((m) =>
                isUserMessage(m) &&
                Math.abs(m.createdAt - optimistic.createdAt) < 10_000
            )
            if (hasServerUserMessage) {
                continue
            }
        }
        result.push(optimistic)
    }

    result.sort(compareMessages)
    return result
}
