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

import { logger } from '@/ui/logger'
import { scanTranscriptForUuid } from './transcriptScan'

/**
 * rewind 锚点换算：用户消息 nativeId → resumeSessionAt 保留锚（目标前最近一条 user/assistant entry 的 uuid）。
 *
 * - resumeSessionAt 语义是「加载到该条（含）为止」——直接传用户消息 uuid 会保留它，
 *   Web 回填原文重发即产生重复，故必须换算到其前驱 entry
 * - 锚必须取「目标前最近一条 user/assistant entry」而非「最近 assistant」：截断区间的
 *   第一条可丢弃 entry 必须恰为声明的 turn prompt（resumeDropsTurn 配对校验），否则 SDK
 *   以「range does not start with the declared turn prompt」拒绝。上一 turn 被打断时，
 *   其尾随 tool_result / [Request interrupted by user]（都是 user 类型）须一并保留在
 *   历史里——它们本就是打断时点的现场（2026-09-21 事故：锚落在中断 turn 中途的 tool_use，
 *   截断区间以 tool_result 开头被拒）
 * - 同一次扫描完成存在性校验（假锚点 / 换链旧行不在当前 transcript → null），
 *   是所有「数据漂移」类失败（spec §6 #1/#2/#3/#4）的统一预检兜底
 * - 锚前无任何 user/assistant entry（链首）→ null，调用方按拒绝处理（等于 rewind 到会话起点，语义不支持）
 */
export async function findRewindAnchor(
    sessionId: string,
    dir: string,
    nativeId: string,
): Promise<string | null> {
    let anchor: string | null = null
    const outcome = await scanTranscriptForUuid(sessionId, dir, nativeId, (scanned, idx) => {
        // 从锚点向前（更早）找最近一条 user/assistant entry 即保留锚
        // （锚点命中页时其前驱必在已扫前缀内，无需反向跨页；system 等非消息 entry 不作锚）
        for (let i = idx - 1; i >= 0; i--) {
            const type = scanned[i].type
            if (type === 'assistant' || type === 'user') {
                anchor = scanned[i].uuid
                return
            }
        }
        // 锚是链首：无可保留前驱
        logger.debug(`[rewindAnchor] anchor ${nativeId} is chain head, no preceding user/assistant entry`)
    })
    if (outcome === 'not-found') return null
    return anchor
}
