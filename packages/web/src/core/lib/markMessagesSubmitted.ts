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

import type { DecryptedMessage } from '@/core/data/api/types'

/**
 * 把 localId 命中的排队消息翻为 consumed（queueState='consumed' + submittedAt + status='sent'）。
 * first-write-wins：已是 consumed 的不动。调用方拿到 messages 数组、用 setQueryData 写回。
 */
export function markMessagesSubmitted(
    messages: DecryptedMessage[],
    localIds: string[],
    submittedAt: number,
): DecryptedMessage[] {
    const set = new Set(localIds)
    let changed = false
    const next = messages.map(m => {
        if (m.localId && set.has(m.localId) && m.queueState !== 'consumed') {
            changed = true
            return { ...m, queueState: 'consumed' as const, submittedAt, status: 'sent' as const }
        }
        return m
    })
    // 无命中返回原数组引用——让 store action 的 `next === prev.messages` 守卫生效，避免无意义 notify
    return changed ? next : messages
}
