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
 * 持久化会话行 → 内存会话行的唯一投影点（架构深化候选②）。
 *
 * 此前的摩擦全部发生在「同一组字段有多份手写清单」上：refreshSession 手抄 18 字段
 * 漏了终结三列（warm-on-open 判 pause 恒 false，4a1a3cc5），pinned 也漏过
 * （sessions_pinned 回归）；handleSessionEnd / handleSessionAlive 又各自手写一遍
 * 终结字段。DB 加列时没有任何机制强制投影跟上。
 *
 * 本模块把两类翻译收在一处：
 * - projectSession：整行装配（含 schema 窄化），DB 加字段只需改这里
 * - applySessionEnd：终结快照的内存增量写/清，事件路径共用
 *
 * 纯函数、无 store 依赖——测试直接喂 StoredSession 断言 Session，无需起整个
 * SessionCache + 假 publisher。
 */

import { AgentStateSchema, MetadataSchema, RuntimeStateSchema } from '@mobi/shared/schemas'
import { SessionEndReasonSchema, SessionPauseTriggerSchema } from '@mobi/shared'
import type { Session, SessionEndReason, SessionPauseTrigger } from '@mobi/shared/types'
import type { StoredSession } from '../store'

/** 终结快照（内存/事件路径形态；DB 侧是 end_state 单列 JSON） */
export type SessionEndSnapshot = {
    reason: SessionEndReason
    trigger: SessionPauseTrigger | null
    at: number | null
}

/**
 * 整行投影：stored → 内存 Session。
 *
 * `existing` 提供只存在于内存的状态（active/activeAt/running/runningAt/mode）——
 * 这些字段不落库，重载时必须保留；缺省时 activeAt 取当前时间，避免刚加载就被
 * expireInactive 驱逐。
 */
export function projectSession(stored: StoredSession, existing?: Session): Session {
    const metadata = (() => {
        const parsed = MetadataSchema.safeParse(stored.metadata)
        return parsed.success ? parsed.data : null
    })()

    const agentState = (() => {
        const parsed = AgentStateSchema.safeParse(stored.agentState)
        return parsed.success ? parsed.data : null
    })()

    const runtimeState = (() => {
        if (stored.runtimeState === null) return undefined
        const parsed = RuntimeStateSchema.safeParse(stored.runtimeState)
        return parsed.success ? parsed.data : undefined
    })()

    const session: Session = {
        id: stored.id,
        namespace: stored.namespace,
        seq: stored.seq,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
        // active 和 activeAt 只从内存获取，不存储在数据库中
        active: existing?.active ?? false,
        // 重载时使用当前时间避免立即被 expireInactive 驱逐
        activeAt: existing?.activeAt ?? Date.now(),
        metadata,
        metadataVersion: stored.metadataVersion,
        agentState,
        agentStateVersion: stored.agentStateVersion,
        running: existing?.running ?? false,
        runningAt: existing?.runningAt ?? 0,
        runtimeState,
        mode: existing?.mode,
        tag: stored.tag,
        // 归属工作区（null = 游离）：必须显式带上，否则路由层读 session.workspaceId 恒 undefined
        workspaceId: stored.workspaceId,
        // 置顶态：必须显式带上，否则 GET /sessions 与 SSE session-updated 载荷的
        // toSessionSummary 读 session.pinned 恒 undefined → 全局缓存反复抹掉 pinned，
        // 「置顶」分组按钮态/成员资格与分页查询打架（见 sessions_pinned 回归）
        pinned: stored.pinned,
        // 终结快照：store 层是 string | null，经 schema 校验窄化（脏值按 null，防扩散）
        endReason: SessionEndReasonSchema.nullable().catch(null).parse(stored.endReason),
        pauseTrigger: SessionPauseTriggerSchema.nullable().catch(null).parse(stored.pauseTrigger),
        endedAt: stored.endedAt,
    }

    // permissionMode 顶层可写快照已删除（深化候选⑤）：降级为 runtimeState.permissionMode 的
    // 只读投影 getter——可写副本仅剩 runtimeState 一处（RuntimeStateStore.merge），「双写漂移」
    // 类 bug（2fd3150e 漏落库 / 88da6179 失败脏写）失去存在土壤。getter 使 wire 形状不变
    // （GET /sessions/:id 与 session-updated 全量载荷 JSON 序列化时自动带值），daemon 重启后
    // refreshSession 也自动从 DB runtimeState 恢复；严格模式下赋值会 TypeError（暴露漏改的写点）
    Object.defineProperty(session, 'permissionMode', {
        get: () => session.runtimeState?.permissionMode,
        enumerable: true,
    })

    return session
}

/**
 * 终结快照的内存增量写/清（事件路径共用）。
 *
 * `null` = 唤醒收口（session-alive 到达）：清三字段，与 DB 的 clearSessionEnd 对应；
 * 有值 = session-end 到达：按落库同值同步内存行，pause 态消费方（WarmOnOpen）即时可判。
 * store 侧写库仍由调用方负责——本函数只改内存，保持纯函数可测。
 */
export function applySessionEnd(session: Session, end: SessionEndSnapshot | null): void {
    if (end === null) {
        session.endReason = null
        session.pauseTrigger = null
        session.endedAt = null
        return
    }
    session.endReason = end.reason
    session.pauseTrigger = end.trigger
    session.endedAt = end.at
}
