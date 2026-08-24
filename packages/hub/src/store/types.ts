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

import type { MessageLifecycle, NativeMessageMetadata, Project } from '@mobi/shared'

export type StoredSession = {
    id: string
    tag: string | null
    namespace: string
    machineId: string | null
    createdAt: number
    updatedAt: number
    metadata: unknown | null
    metadataVersion: number
    agentState: unknown | null
    agentStateVersion: number
    runtimeState: unknown | null
    runtimeStateUpdatedAt: number | null
    /** 归属项目 id；游离会话为 null */
    projectId: string | null
    /** 会话置顶（true = 进「置顶」分组，同时从「项目」「最近」过滤掉） */
    pinned: boolean
    seq: number
}

export type StoredMachine = {
    id: string
    namespace: string
    createdAt: number
    updatedAt: number
    metadata: unknown | null
    metadataVersion: number
    runnerState: unknown | null
    runnerStateVersion: number
    active: boolean
    activeAt: number | null
    seq: number
}

export type StoredMessage = {
    id: string
    sessionId: string
    content: unknown
    createdAt: number
    seq: number
    localId: string | null
    /** 上游 native 事实（rewind 锚点 + 所属上游 session）；null = 未记录（不可 rewind 锚点）。
     *  Phase 1 的独立 native_id 列已废弃，统一收敛到此 JSON 字段 */
    metadata: NativeMessageMetadata | null
    /** 软删除时刻（rewind 截断）；null = 未删除。读取路径统一过滤已删行 */
    deletedAt: number | null
    isSidechain: boolean
    parentToolUseId: string | null
    category: string  // 'discard' | 'ephemeral' | 'persistent'
    /** 用户消息生命周期；null = 非排队轨道。推进单调（queued→pushed→acked→…），终态不复位 */
    lifecycle: MessageLifecycle | null
    /** lifecycle 当前态的进入时刻（queued 时 = created_at）；非排队轨道恒 null */
    lifecycleAt: number | null
    /** 排序锚点；排队消息消费时跳到消费时刻 */
    positionAt: number
}

/** 项目实体存储形态（直接复用 shared 的 Project 定义） */
export type StoredProject = Project

export type StoredUser = {
    id: number
    platform: string
    platformUserId: string
    namespace: string
    createdAt: number
}

export type StoredPushSubscription = {
    id: number
    namespace: string
    endpoint: string
    p256dh: string
    auth: string
    createdAt: number
}

export type VersionedUpdateResult<T> =
    | { result: 'success'; version: number; value: T }
    | { result: 'version-mismatch'; version: number; value: T }
    | { result: 'error' }
