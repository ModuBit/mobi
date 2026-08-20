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
 * rewind 软删除上界记录（M3 防御）：rewind API 受理时记录该会话当时的最大 seq，
 * `rewound-truncated` 截断回报到达时消费——软删除收窄为 `deleteFromSeq <= seq <= 上界`。
 *
 * 动机：截断回报可能**迟到**（CLI 卡住数十秒后恢复）。Web 超时兜底已解锁输入，
 * 用户迟到窗口内发的新消息 seq 大于锚点 seq，无上界的 `seq >= deleteFromSeq`
 * 会把新消息一并软删除——数据丢失。上界把删除范围钉死在「受理时已存在的行」。
 *
 * 对齐 BackgroundTaskTracker 的注入模式：index.ts 组装层创建，SyncEngine（受理时写）
 * 与 CLI socket handler（截断回报时读）共用同一实例。
 *
 * 内存语义：hub 重启丢上界 → 截断回报回退到无上界删除（回到旧行为，罕见窗口内可接受）。
 */

export class RewindDeleteBoundTracker {
    private readonly bounds = new Map<string, number>()
    /** 每会话最近已处理的截断回报键（`nativeId:deleteFromSeq`）——CLI 可靠队列重放的幂等去重键 */
    private readonly truncatedKeys = new Map<string, string[]>()
    /** 每会话保留的去重键数量上限：同会话短时间多次 rewind 的键都需在场，超出淘汰最旧 */
    private static readonly MAX_TRACKED_KEYS = 8

    /** rewind 受理成功（CLI accepted）时记录软删除上界（受理时点会话最大 seq） */
    markAccepted(sessionId: string, maxSeq: number): void {
        this.bounds.set(sessionId, maxSeq)
    }

    /** 截断回报消费上界（一次性：读即清，防陈旧上界波及后续 rewind）。无记录返回 null。 */
    consume(sessionId: string): number | null {
        const bound = this.bounds.get(sessionId)
        if (bound === undefined) return null
        this.bounds.delete(sessionId)
        return bound
    }

    /**
     * 截断回报去重（重放幂等）：同一 (nativeId, deleteFromSeq) 的重复回报只处理一次。
     * 首见记录并返回 false；重放返回 true（调用方跳过软删除与 SSE，仅回 ack）。
     * 同锚点的合法 rewind 不可能重演（锚点行已被删），同键重见必然是 CLI 重放。
     *
     * 保留最近 N 个键而非单槽：A 的重放可能被另一 rewind B 的回报插队（单槽被 B 覆盖），
     * 单槽判定会误把 A 的重放当首见，重新执行无上界软删除。
     */
    isDuplicateTruncated(sessionId: string, nativeId: string, deleteFromSeq: number): boolean {
        const key = `${nativeId}:${deleteFromSeq}`
        const keys = this.truncatedKeys.get(sessionId)
        if (keys?.includes(key)) return true
        const next = [...(keys ?? []), key]
        if (next.length > RewindDeleteBoundTracker.MAX_TRACKED_KEYS) {
            next.splice(0, next.length - RewindDeleteBoundTracker.MAX_TRACKED_KEYS)
        }
        this.truncatedKeys.set(sessionId, next)
        return false
    }
}
