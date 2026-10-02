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

import type { RuntimeState, Session } from '@mobi/shared/types'
import type { Store } from '../store'

export interface RuntimeStateMergeResult {
    /** 合并后的完整 runtimeState（已回填内存 session） */
    merged: RuntimeState
    /** 本次合并相对 DB 现值是否发生变化（store 层判定：不变时跳过写库、seq 不推进） */
    changed: boolean
}

/**
 * runtimeState 写路径单一收口（深化候选⑤）：「DB 字段级合并落库 → 内存 session 回填 →
 * changed 判定」三连在此原子完成。
 *
 * - **写序即实现**：先落库，成功后才回填内存——写库失败 throw 时内存不脏
 *   （88da6179 修的「失败脏写」bug 类由结构消除，不再靠调用点注释维系）
 * - **字段级合并**：patch 出现的 key 覆盖（value === undefined 视为清除）、未出现的 key
 *   保留 DB 现值——不基于内存快照全量覆盖，session-message 等直写 DB 路径的新值
 *   （todos/backgroundTasks）不被抹掉（#62 双写竞态根修）
 * - **changed 透传**：store 层以合并结果 vs DB 现值判定，调用方据此省略广播
 *   （keep-alive 的 modeChanged 即由它替代手写字段 diff——新增字段零接线）
 */
export class RuntimeStateStore {
    constructor(private readonly store: Store) {
    }

    merge(session: Session, patch: Record<string, unknown>, updatedAt: number = Date.now()): RuntimeStateMergeResult {
        const result = this.store.sessions.mergeRuntimeState(session.id, patch, updatedAt, session.namespace)
        if (!result) {
            throw new Error(`Failed to merge runtime state (id=${session.id}, fields=${Object.keys(patch).join(',')})`)
        }
        session.runtimeState = result.merged as RuntimeState
        return { merged: session.runtimeState, changed: result.changed }
    }
}
