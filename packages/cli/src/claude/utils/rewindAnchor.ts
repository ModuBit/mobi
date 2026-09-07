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
 * rewind 锚点换算：用户消息 nativeId → resumeSessionAt 保留锚（其前最近一条 assistant entry 的 uuid）。
 *
 * - resumeSessionAt 语义是「加载到该条（含）为止」——直接传用户消息 uuid 会保留它，
 *   Web 回填原文重发即产生重复，故必须换算到其前驱 assistant
 * - 同一次扫描完成存在性校验（假锚点 / 换链旧行不在当前 transcript → null），
 *   是所有「数据漂移」类失败（spec §6 #1/#2/#3/#4）的统一预检兜底
 * - 锚是链首（前面无 assistant）→ null，调用方按拒绝处理（等于 rewind 到会话起点，语义不支持）
 */
export async function findRewindAnchor(
    sessionId: string,
    dir: string,
    nativeId: string,
): Promise<string | null> {
    let anchor: string | null = null
    const outcome = await scanTranscriptForUuid(sessionId, dir, nativeId, (scanned, idx) => {
        // 从锚点向前（更早）找最近一条 assistant entry 即保留锚
        // （锚点命中页时其前驱必在已扫前缀内，无需反向跨页）
        for (let i = idx - 1; i >= 0; i--) {
            if (scanned[i].type === 'assistant') {
                anchor = scanned[i].uuid
                return
            }
        }
        // 锚是链首：无可保留前驱
        logger.debug(`[rewindAnchor] anchor ${nativeId} is chain head, no preceding assistant`)
    })
    if (outcome === 'not-found') return null
    return anchor
}
