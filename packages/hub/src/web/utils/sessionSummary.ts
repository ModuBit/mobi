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

import type { SessionSummary } from '@mobi/shared'
import { toSessionSummary } from '@mobi/shared'
import type { StoredSession } from '../../store'
import type { Session, SyncEngine } from '../../sync/syncEngine'

/**
 * 将分页查出的 StoredSession 修饰为 SessionSummary（复用 shared 的 toSessionSummary，
 * 不本地复刻字段装配）。active/running/activeAt/mode 不入库，只能取内存会话缓存的
 * 实时值——逐 id 调 engine.getSession（缓存命中），替代每个分页请求全 namespace
 * 扫描建 Map 只为修饰 ≤limit 行的 O(namespace) 浪费。
 * 项目 / 「最近」/ 「置顶」三类分页路由共用，避免 live 态装配逻辑散落多份漂移
 */
export function toSummaryWithLiveState(engine: SyncEngine, stored: StoredSession): SessionSummary {
    const live = engine.getSession(stored.id)
    // 存储字段（updatedAt/metadata/进度计数）以分页行为准，仅叠加内存态字段
    const session = {
        ...stored,
        active: live?.active ?? false,
        activeAt: live?.activeAt ?? 0,
        running: live?.running ?? false,
        mode: live?.mode,
    } as unknown as Session
    return toSessionSummary(session)
}
