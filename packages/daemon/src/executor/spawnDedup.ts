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
 * 唤醒去重（spec .scratch/wake-dedup + pending #108 双键扩展）：server 判定会话「离线」
 * 只看 socket，不知道进程死活；盲 spawn 会与「活着但断连中」或「在途启动中」的旧进程
 * 构成双进程（CC 并发 resume 无锁，安静交错写同一份 jsonl；新会话回退 spawn 则同一 mobi
 * 行挂上两个不同 native session）。本模块是查重决策的纯函数单源：给定在册 child 集合与
 * 本次 spawn 的比对键，返回命中的活表项或 null。
 *
 * 「表项存在 = 进程存活」由 executor 既有 exit 清理保证（child 退出即删表项，含
 * SIGKILL——executor 是直接父进程必然收到 exit 事件），不另设探活。
 */

import type { TrackedSession } from './types'
import type { SpawnSessionResult } from '@mobi/shared/hostProtocol'

/** spawn 查重键：两键任一命中即拦。都缺（Web 新会话 spawn，行 id 尚不存在）不查重 */
export type SpawnDedupKey = {
    /** resume 目标（native session id）：唤醒 spawn 携带，与在册 child 的同名字段比对 */
    resumeSessionId?: string
    /** mobi 会话行 id：daemon 唤醒/激活路径携带（resumeSession 已知目标行）。
     *  在册 child 的 MobiSessionId 由 webhook（/session-started）或 spawn 注册戳
     *  （options.sessionId）回填——本键覆盖「webhook 已到、socket 未活跃」的首条消息
     *  唤醒竞态窗口（#108：SDK 0.3.29x 启动变慢后必然踩中） */
    mobiSessionId?: string
}

/**
 * 在在册 child 中查「属于同一会话」的活表项：resume 目标相同，或 mobi 行 id 相同。
 * 表项缺键（手动 / webhook 注册前拿不到该信息）不参与该键比对。
 * resumeSessionId / mobiSessionId 为空串视为未提供（与 undefined 同义）。
 */
export function findRunningDuplicate(
    children: Iterable<TrackedSession>,
    key: SpawnDedupKey,
): TrackedSession | null {
    const resume = key.resumeSessionId || undefined
    const mobi = key.mobiSessionId || undefined
    if (!resume && !mobi) return null
    for (const tracked of children) {
        if (resume && tracked.resumeSessionId && tracked.resumeSessionId === resume) {
            return tracked
        }
        if (mobi && tracked.MobiSessionId && tracked.MobiSessionId === mobi) {
            return tracked
        }
    }
    return null
}

/**
 * spawn 入口的去重闸（查重 + 结果构造收口于此，run.ts 只做早退）：命中返回
 * already-running 结果（不携带 spawn 产物字段——本分支没有新进程），未命中返回
 * null 放行。引用在册表 live Map：表项被 exit 清理删掉后同一请求自然放行。
 */
export function createSpawnDedupGuard(children: Map<number, TrackedSession>) {
    return (key: SpawnDedupKey): SpawnSessionResult | null => {
        return findRunningDuplicate(children.values(), key)
            ? { type: 'already-running' }
            : null
    }
}
