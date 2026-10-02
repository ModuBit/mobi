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
 * 唤醒去重（spec .scratch/wake-dedup）：hub 判定会话「离线」只看 socket，不知道
 * 进程死活；盲 spawn 会与「活着但断连中」的旧进程构成双进程（CC 并发 resume 无锁，
 * 安静交错写同一份 jsonl）。本模块是查重决策的纯函数单源：给定在册 child 集合与
 * 本次 spawn 的 resume 目标，返回命中的活表项或 null。
 *
 * 「表项存在 = 进程存活」由 runner 既有 exit 清理保证（child 退出即删表项，含
 * SIGKILL——runner 是直接父进程必然收到 exit 事件），不另设探活。
 */

import type { TrackedSession } from './types'
import type { SpawnSessionResult } from '@/modules/common/rpcTypes'

/**
 * 在在册 child 中查「resume 目标相同」的活表项。无 resume 目标的表项（手动 /
 * webhook 注册，拿不到该信息）不参与比对——这类场景由唤醒的幂等语义兜底。
 * resumeSessionId 为空串视为未提供（与 undefined 同义）。
 */
export function findRunningResumeDuplicate(
    children: Iterable<TrackedSession>,
    resumeSessionId: string | undefined,
): TrackedSession | null {
    if (!resumeSessionId) return null
    for (const tracked of children) {
        if (tracked.resumeSessionId && tracked.resumeSessionId === resumeSessionId) {
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
export function createResumeDedupGuard(children: Map<number, TrackedSession>) {
    return (resumeSessionId: string | undefined): SpawnSessionResult | null => {
        return findRunningResumeDuplicate(children.values(), resumeSessionId)
            ? { type: 'already-running' }
            : null
    }
}
