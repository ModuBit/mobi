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

// forked skill tap 的会话级去重状态（spec forked-code-review-tap）：
// 「实时行已消费的 uuid」这一事实，生产者是 forkedSkillTapSubscriber（bridge 订阅），
// 消费者是 SDK 流入口（remote 的 onMessage / local 的 scanner）——两端共享同一集合，
// 流末尾的批量重放据此丢弃。
//
// 单例而非传参：mobi 会话进程与会话一一对应（per-session spawn），进程级状态即
// 会话级状态（与 MOBI_BRIDGE_SOCK 的 process.env 注入同一前提）。

import { shouldSuppressStreamMessage, type StreamMessageShape } from '@mobi/shared';

/** 去重集合容量上限（fork 行一次几十条；沿用 goal 的 2000，防长会话无界增长） */
const MAX_SEEN_UUIDS = 2000;

const seenUuids = new Set<string>();

/** 记录一条已由实时行消费的 uuid（订阅者拼行成功后调用） */
export function rememberLiveRowUuid(uuid: string): void {
    seenUuids.add(uuid);
    if (seenUuids.size > MAX_SEEN_UUIDS) {
        const oldest = seenUuids.values().next().value;
        if (oldest !== undefined) seenUuids.delete(oldest);
    }
}

/** 当前会话是否已消费该 uuid（测试与排障用） */
export function hasLiveRowUuid(uuid: string): boolean {
    return seenUuids.has(uuid);
}

/** 流消息是否应被抑制（判定规则单源在 shared，见 shouldSuppressStreamMessage） */
export function shouldSuppressSessionStreamMessage(message: StreamMessageShape): boolean {
    return shouldSuppressStreamMessage(message, seenUuids);
}

/** 清空会话级状态（单元测试用；会话进程启动时天然为空） */
export function resetForkedSkillTapState(): void {
    seenUuids.clear();
}
