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

import { getSessionMessages, type SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '@/ui/logger'

/** 正向分页每页条数 */
const PAGE_SIZE = 50
/** 最大回扫页数（防病态长链死循环；50×40=2000 条 entry 覆盖常规会话） */
const MAX_PAGES = 40

/**
 * rewind 锚点换算：用户消息 nativeId → resumeSessionAt 保留锚（其前最近一条 assistant entry 的 uuid）。
 *
 * - resumeSessionAt 语义是「加载到该条（含）为止」——直接传用户消息 uuid 会保留它，
 *   Web 回填原文重发即产生重复，故必须换算到其前驱 assistant
 * - 同一次扫描完成存在性校验（假锚点 / 换链旧行不在当前 transcript → null），
 *   是所有「数据漂移」类失败（spec §6 #1/#2/#3/#4）的统一预检兜底
 * - 分页方向：getSessionMessages 返回旧→新（index 0 = 最早）、offset 从头部正向跳过
 *   （PoC poc8 实测结论）。目标 uuid 命中页时其前驱必在已扫前缀内，无需反向跨页
 * - uuid 必须精确匹配：user 类型 entry 还包括 tool_result 载体，不能按「第 N 条 user」计数
 * - 锚是链首（前面无 assistant）→ null，调用方按拒绝处理（等于 rewind 到会话起点，语义不支持）
 */
export async function findRewindAnchor(
    sessionId: string,
    dir: string,
    nativeId: string,
): Promise<string | null> {
    /** 已扫过的 entry（旧→新顺序保持）；锚点的前驱 assistant 一定落在已扫前缀内 */
    const scanned: SessionMessage[] = []

    for (let page = 0; page < MAX_PAGES; page++) {
        const messages = await getSessionMessages(sessionId, { dir, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
        if (messages.length === 0) {
            // 空页：transcript 已扫完（或会话不存在）仍未命中 → 假锚点
            logger.debug(`[rewindAnchor] exhausted transcript without hitting ${nativeId} (page=${page})`)
            return null
        }
        scanned.push(...messages)

        const idx = scanned.findIndex(m => m.uuid === nativeId)
        if (idx >= 0) {
            // 从锚点向前（更早）找最近一条 assistant entry 即保留锚
            for (let i = idx - 1; i >= 0; i--) {
                if (scanned[i].type === 'assistant') {
                    return scanned[i].uuid
                }
            }
            // 锚是链首：无可保留前驱
            logger.debug(`[rewindAnchor] anchor ${nativeId} is chain head, no preceding assistant`)
            return null
        }

        if (messages.length < PAGE_SIZE) {
            // 末页不满：全量已扫完，锚点不存在
            logger.debug(`[rewindAnchor] reached transcript end without hitting ${nativeId}`)
            return null
        }
    }

    // 超出回扫上限仍未命中：按假锚点拒绝（防病态长链）
    logger.warn(`[rewindAnchor] exceeded MAX_PAGES (${MAX_PAGES}) without hitting ${nativeId}`)
    return null
}
