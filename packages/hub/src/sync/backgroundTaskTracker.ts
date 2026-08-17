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
 * 活跃后台任务集合——rewind 闸门的权威数据源。
 *
 * 写侧：CLI socket handler 解析 background_tasks_changed 后整体替换（replace 语义，
 * SDK 权威集合，见 sessionHandlers）；读侧：rewind API 路由在受理前查询
 * 「该会话是否有在途后台任务」（前台 running 由 CLI 侧闸门把守）。
 *
 * 已知限制（设计接受，不设防）：CLI 断线重连窗口内集合可能失真——
 * 误放行由 CLI 执行闸门（队列/running/锚点预检）兜底拒绝。
 */
export class BackgroundTaskTracker {
    /** sessionId → 活跃后台任务 ID 集合（空集条目不落 Map，避免随会话数无界增长） */
    private readonly active = new Map<string, Set<string>>()

    /** 整体替换该会话的活跃集合（background_tasks_changed replace 语义）。空集即清空该会话在途任务。 */
    replace(sessionId: string, taskIds: Iterable<string>): void {
        const list = [...taskIds]
        if (list.length === 0) {
            this.active.delete(sessionId)
            return
        }
        const set = this.active.get(sessionId) ?? new Set<string>()
        set.clear()
        for (const id of list) set.add(id)
        this.active.set(sessionId, set)
    }

    /** 该会话当前活跃集合（无记录时共享空集只读引用；每次调用现取，后续 replace 即可见） */
    getActive(sessionId: string): ReadonlySet<string> {
        return this.active.get(sessionId) ?? EMPTY_SET
    }

    /** rewind 闸门：该会话是否存在在途后台任务 */
    hasActive(sessionId: string): boolean {
        return (this.active.get(sessionId)?.size ?? 0) > 0
    }
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>()
